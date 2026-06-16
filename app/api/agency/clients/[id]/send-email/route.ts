import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * POST /api/agency/clients/[id]/send-email
 *
 * 指定クライアントにメールを送信する。
 * - Resend API 経由(RESEND_API_KEY + EMAIL_FROM が必須)
 * - 送信成功時、client_interactions に "email" タイプの履歴を残す
 * - 監査ログ(client_audit_log)には記録しない:対応履歴 + interactions が
 *   既に「送信した事実」を残しているため、二重記録を避ける
 *
 * セキュリティ:
 *   - 認証 + 組織メンバーガード
 *   - RLS により自社のクライアントにしか送れない
 *   - 件名 / 本文は 200 / 5000 文字制限(Resend / 受信側両方の負荷防御)
 */

const requestSchema = z.object({
  subject: z.string().min(1, "件名を入力してください").max(200),
  body: z.string().min(1, "本文を入力してください").max(5000),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

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

  // 顧客のメールアドレスを取得(RLS で自社のみ)
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("id, name, email, email_distribution_enabled")
    .eq("id", id)
    .eq("organization_id", role.organization.id)
    .maybeSingle();
  if (!clientRow) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const client = clientRow as {
    id: string;
    name: string;
    email: string;
    email_distribution_enabled: boolean;
  };

  // 配信停止フラグが立っているクライアントには送らない(MA と同じ尊重)
  if (!client.email_distribution_enabled) {
    return NextResponse.json(
      { error: "このクライアントは配信停止に設定されています" },
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

  // Resend へ送信
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [client.email],
        subject: parsed.data.subject,
        text: parsed.data.body,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `送信失敗: HTTP ${res.status} ${errBody}` },
        { status: 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    return NextResponse.json({ error: `通信エラー: ${message}` }, { status: 502 });
  }

  // 成功時:対応履歴に email タイプで残す(summary = 件名、body = 本文)
  await supabase.from("client_interactions").insert({
    organization_id: role.organization.id,
    client_record_id: client.id,
    author_member_id: role.member.id,
    interaction_type: "email",
    occurred_at: new Date().toISOString(),
    summary: parsed.data.subject,
    body: parsed.data.body,
  });

  return NextResponse.json({ success: true });
}
