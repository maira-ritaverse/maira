/**
 * POST /api/marketing/roi-simulation
 *
 * LP の /roi ページ から の 試算 結果 + 会社 情報 を 受信。 認証 不要 ( 公開 フォーム )。
 *
 * 動作:
 *   1. 入力 検証 ( Zod )
 *   2. 計算 結果 を サーバー 側 で 再計算 ( クライアント の 改ざん 防止 )
 *   3. roi_simulations テーブル に 1 行 INSERT ( service_role 経由 で RLS バイパス )
 *   4. 運営 宛 通知 メール + 申込 者 宛 自動 返信 を 並列 送信
 *
 * 簡易 スパム 防御:
 *   ・honeypot ( name="website" )
 *   ・必須 フィールド の 長さ 制限
 */
import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  sendRoiSubmissionAutoReply,
  sendRoiSubmissionNotificationToOperator,
  type RoiSubmissionPayload,
} from "@/lib/email/roi-submission";
import { calculateRoi, type RoiInput } from "@/lib/marketing/roi";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // 必須 ( マーケ リード )
  companyName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(120),
  email: z.string().email().max(320),
  // 任意
  role: z.string().max(80).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  industry: z.string().max(80).optional().nullable(),
  // ROI 入力 ( 数値 範囲 は DB CHECK と 整合 )
  advisorCount: z.number().int().min(0).max(100000),
  monthlyClients: z.number().int().min(0).max(1000000),
  monthlyDeals: z.number().int().min(0).max(1000000),
  avgFeeManYen: z.number().int().min(0).max(100000),
  docMinutesPerCase: z.number().int().min(0).max(1440),
  monthlyLostLeads: z.number().int().min(0).max(1000000).optional().nullable(),
  advisorHourlyYen: z.number().int().min(0).max(1000000).optional().nullable(),
  // honeypot
  website: z.string().max(200).optional().nullable(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // honeypot 検出 = 「成功」 を 返して bot に 誤認 さ せる
  if (parsed.data.website && parsed.data.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const data = parsed.data;

  // サーバー 側 で 再計算 ( クライアント 改ざん 防止 )
  const roiInput: RoiInput = {
    advisorCount: data.advisorCount,
    monthlyClients: data.monthlyClients,
    monthlyDeals: data.monthlyDeals,
    avgFeeManYen: data.avgFeeManYen,
    docMinutesPerCase: data.docMinutesPerCase,
    monthlyLostLeads: data.monthlyLostLeads ?? 0,
    advisorHourlyYen: data.advisorHourlyYen ?? 3000,
  };
  const result = calculateRoi(roiInput);

  // ip と ua の 軽量 メタ ( 個人 識別 を 避け、 ハッシュ で )
  const ipRaw =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "";
  const ipHash = ipRaw ? createHash("sha256").update(ipRaw).digest("hex").slice(0, 32) : null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  // DB 保存 ( service_role で RLS バイパス )
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("[roi-simulation] supabase env not configured");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: insertError } = await admin.from("roi_simulations").insert({
    company_name: data.companyName.trim(),
    contact_name: data.contactName.trim(),
    email: data.email.trim(),
    role: data.role?.trim() || null,
    phone: data.phone?.trim() || null,
    industry: data.industry?.trim() || null,
    advisor_count: data.advisorCount,
    monthly_clients: data.monthlyClients,
    monthly_deals: data.monthlyDeals,
    avg_fee_man_yen: data.avgFeeManYen,
    doc_minutes_per_case: data.docMinutesPerCase,
    monthly_lost_leads: data.monthlyLostLeads ?? null,
    advisor_hourly_yen: data.advisorHourlyYen ?? null,
    calculated_yearly_total_yen: Math.round(result.yearly.total),
    calculated_yearly_doc_savings_yen: Math.round(result.yearly.docTimeSavings),
    calculated_yearly_lead_recovery_yen: Math.round(result.yearly.leadRecovery),
    calculated_yearly_deal_uplift_yen: Math.round(result.yearly.dealUplift),
    user_agent: userAgent,
    ip_hash: ipHash,
  });

  if (insertError) {
    console.error("[roi-simulation] insert failed", insertError);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // 並列 で メール 送信
  const payload: RoiSubmissionPayload = {
    companyName: data.companyName.trim(),
    contactName: data.contactName.trim(),
    email: data.email.trim(),
    role: data.role?.trim() || null,
    phone: data.phone?.trim() || null,
    industry: data.industry?.trim() || null,
    advisorCount: data.advisorCount,
    monthlyClients: data.monthlyClients,
    monthlyDeals: data.monthlyDeals,
    avgFeeManYen: data.avgFeeManYen,
    docMinutesPerCase: data.docMinutesPerCase,
    monthlyLostLeads: data.monthlyLostLeads ?? null,
    advisorHourlyYen: data.advisorHourlyYen ?? null,
    yearlyTotalYen: result.yearly.total,
    yearlyDocSavingsYen: result.yearly.docTimeSavings,
    yearlyLeadRecoveryYen: result.yearly.leadRecovery,
    yearlyDealUpliftYen: result.yearly.dealUplift,
  };

  const [opResult, autoResult] = await Promise.all([
    sendRoiSubmissionNotificationToOperator(payload),
    sendRoiSubmissionAutoReply(payload),
  ]);
  if (!opResult.sent) console.warn("[roi-simulation] operator notification failed", opResult);
  if (!autoResult.sent) console.warn("[roi-simulation] auto reply failed", autoResult);

  return NextResponse.json({
    ok: true,
    yearlyTotal: result.yearly.total,
  });
}
