import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * POST /api/agency/clients/bulk-email
 *
 * 選択中のクライアント群に対してメールを一斉送信する。
 * 各メールは個別宛(BCC ではない)で、変数 {client_name} を顧客名で差し替える。
 * 送信成功時、クライアントごとに対応履歴(email)を残す。
 *
 * 制限:
 *   - ids 上限 200(誤コピペでの暴発防止)
 *   - 配信停止フラグ(email_distribution_enabled=false)の顧客はスキップ
 *   - 環境変数(RESEND_API_KEY / EMAIL_FROM)未設定なら 503
 *
 * 結果:
 *   - 各 ID ごとの outcome を返す:sent / suppressed_distribution_off / failed
 */

const MAX_IDS = 200;

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_IDS),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

type Outcome = {
  clientId: string;
  status: "sent" | "suppressed_distribution_off" | "failed";
  message?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return NextResponse.json(
      { error: "メール送信が未設定です(RESEND_API_KEY / EMAIL_FROM)" },
      { status: 503 },
    );
  }

  const { ids, subject, body: bodyText } = parsed.data;
  const orgId = role.organization.id;

  // 対象クライアント(RLS で自社のみ)
  const { data: clientRows, error: clientErr } = await supabase
    .from("client_records")
    .select("id, name, email, email_distribution_enabled")
    .in("id", ids)
    .eq("organization_id", orgId);
  if (clientErr || !clientRows) {
    return NextResponse.json(
      { error: "Failed to load clients", message: clientErr?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  const results: Outcome[] = [];
  const interactionInserts: Array<Record<string, unknown>> = [];

  for (const c of clientRows as Array<{
    id: string;
    name: string;
    email: string;
    email_distribution_enabled: boolean;
  }>) {
    if (!c.email_distribution_enabled) {
      results.push({ clientId: c.id, status: "suppressed_distribution_off" });
      continue;
    }

    // 変数差し替え:{client_name} のみサポート(個人ごとに差別化する用)
    const personalSubject = subject.replace(/\{client_name\}/g, c.name);
    const personalBody = bodyText.replace(/\{client_name\}/g, c.name);

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [c.email],
          subject: personalSubject,
          text: personalBody,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        results.push({
          clientId: c.id,
          status: "failed",
          message: `HTTP ${res.status}: ${t.slice(0, 200)}`,
        });
        continue;
      }
      results.push({ clientId: c.id, status: "sent" });
      // 対応履歴を後で一括 INSERT 用に蓄積
      interactionInserts.push({
        organization_id: orgId,
        client_record_id: c.id,
        author_member_id: role.member.id,
        interaction_type: "email",
        occurred_at: new Date().toISOString(),
        summary: personalSubject,
        body: personalBody,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      results.push({ clientId: c.id, status: "failed", message });
    }
  }

  if (interactionInserts.length > 0) {
    const { error: insErr } = await supabase.from("client_interactions").insert(interactionInserts);
    if (insErr) {
      console.warn("[bulk-email] interaction insert failed:", insErr.message);
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const suppressed = results.filter((r) => r.status === "suppressed_distribution_off").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({ sent, suppressed, failed, results });
}
