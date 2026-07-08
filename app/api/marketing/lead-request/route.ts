import { NextResponse } from "next/server";
import { z } from "zod";

import {
  sendLeadRequestAutoReply,
  sendLeadRequestNotificationToOperator,
  type LeadRequestPayload,
} from "@/lib/email/lead-request";
import { consumeRateLimit, extractClientIp } from "@/lib/rate-limit/rate-limit";

/**
 * POST /api/marketing/lead-request
 *
 * LP の 「資料 請求」 フォーム から の リード 受信。 認証 不要 (公開 フォーム)。
 *
 * 動作:
 *   1. 入力 検証 (Zod)
 *   2. 運営 宛 通知 メール + 申込 者 宛 自動 返信 を 並列 送信
 *   3. レスポンス は 「ok: true」 のみ (= 詳細 を 漏ら さない)
 *
 * 簡易 スパム 防御:
 *   ・honeypot (= name="website" の hidden フィールド に 値 が 入ったら 即 200)
 *   ・1 IP / 分 N 件 制限 は 将来 検討 (現状 は 運営 通知 で 異常 検知)
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  companyName: z.string().min(1).max(120),
  contactName: z.string().min(1).max(80),
  email: z.string().email().max(254),
  phone: z.string().max(40).optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  /** honeypot — bot が 自動 入力 する 罠 */
  website: z.string().max(200).optional().nullable(),
});

export async function POST(request: Request) {
  // H4 修正: 未認証 エンドポイント で honeypot のみ で bot 対策 が 不十分 だった。
  // 10,000 件 の 実在 メール リスト で POST さ れる と 「ROI 試算 結果」 が スパム
  // 大 量 送信 に なり Resend の SPF/DKIM 評価 と maira.pro ドメイン 評価 が
  // 崩壊 する リスク が あった。 IP 1 分 3 回、 IP 1 時間 10 回 に 制限。
  const ip = extractClientIp(request);
  const [ipMinute, ipHour] = await Promise.all([
    consumeRateLimit({
      namespace: "marketing_lead:ip_minute",
      identifier: ip,
      windowSeconds: 60,
      maxCount: 3,
    }),
    consumeRateLimit({
      namespace: "marketing_lead:ip_hour",
      identifier: ip,
      windowSeconds: 3600,
      maxCount: 10,
    }),
  ]);
  if (ipMinute.limited || ipHour.limited) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "送信 回数 が 多 すぎ ます。 時間 を おいて お試し ください。",
      },
      { status: 429 },
    );
  }

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

  // honeypot 検出 = 200 を 返す (= bot に 「成功 した」 と 誤認 さ せる)
  if (parsed.data.website && parsed.data.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  // email 単位 の 制限 (同 email に 過剰 な 自動 返信 を 送ら ない)
  const emailCheck = await consumeRateLimit({
    namespace: "marketing_lead:email",
    identifier: parsed.data.email.toLowerCase(),
    windowSeconds: 3600,
    maxCount: 3,
    hashIdentifier: true,
  });
  if (emailCheck.limited) {
    return NextResponse.json({ ok: true });
  }

  const payload: LeadRequestPayload = {
    companyName: parsed.data.companyName.trim(),
    contactName: parsed.data.contactName.trim(),
    email: parsed.data.email.trim(),
    phone: parsed.data.phone?.trim() || null,
    source: parsed.data.source?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
  };

  // 並列 送信 (片方 失敗 して も もう 片方 は 送る)
  const [opResult, autoResult] = await Promise.all([
    sendLeadRequestNotificationToOperator(payload),
    sendLeadRequestAutoReply(payload),
  ]);

  if (!opResult.sent) {
    console.warn("[lead-request] operator notification failed", opResult);
  }
  if (!autoResult.sent) {
    console.warn("[lead-request] auto reply failed", autoResult);
  }

  // 申込 者 から 見れば 「受け付けた」 が 全て。 メール 失敗 は 内部 ログ で 追跡。
  return NextResponse.json({ ok: true });
}
