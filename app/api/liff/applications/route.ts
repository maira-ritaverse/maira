import { NextResponse } from "next/server";
import { z } from "zod";

import { encryptField } from "@/lib/crypto/field-encryption";
import { notifyAgencyOfLineMessage } from "@/lib/line/notifications";
import { consumeRateLimit } from "@/lib/rate-limit/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/liff/applications
 *
 * LIFF 求人応募 受付。
 *
 * セキュリティ:
 *   ・LIFF ID Token を LINE API で 検証 (sub = LINE userId)
 *   ・client_id (Channel ID) も 同時に 検証 (なりすまし 防止)
 *   ・成功時、 line_messages に system event 「応募希望」 を 残す
 *   ・関連 求職者 client_record_id を 自動 紐付け (既存 link が あれば)
 *   ・通知 fan-out (in-app + Slack + メール)
 *
 * 入力:
 *   { orgId, jobId, idToken, lineChannelId, comment? }
 */
const bodySchema = z.object({
  orgId: z.string().uuid(),
  jobId: z.string().uuid(),
  idToken: z.string().min(10),
  lineChannelId: z.string().min(1).max(100),
  comment: z.string().max(1000).optional(),
});

type LineVerifyResponse = {
  iss: string;
  sub: string; // LINE userId
  aud: string; // Channel ID
  exp: number;
  name?: string;
  picture?: string;
  email?: string;
  error?: string;
  error_description?: string;
};

export async function POST(request: Request) {
  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { orgId, jobId, idToken, lineChannelId, comment } = parsed.data;

  // LINE ID Token を 公式 endpoint で 検証
  let lineUserId: string;
  let lineDisplayName: string | null = null;
  try {
    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: lineChannelId }).toString(),
    });
    if (!verifyRes.ok) {
      const errText = await verifyRes.text().catch(() => "");
      return NextResponse.json(
        { error: "id_token_invalid", message: errText.slice(0, 200) },
        { status: 401 },
      );
    }
    const data = (await verifyRes.json()) as LineVerifyResponse;
    if (data.aud !== lineChannelId) {
      return NextResponse.json({ error: "channel_mismatch" }, { status: 401 });
    }
    lineUserId = data.sub;
    lineDisplayName = data.name ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: "verify_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  // ── LIFF ID Token を 手 に した 攻撃者 が LOOP で 応募 spam を 送り 通知 fan-out
  //     (Slack + メール + push) を 荒らす の を 阻止。 lineUserId ベース (LIFF ID Token
  //     で 検証 済) で 60 秒 に 3 件 まで。 通常 の 応募 は 1 求人 に 1 回。
  {
    const rlLiff = await consumeRateLimit({
      namespace: "liff:apply:line_user",
      identifier: lineUserId,
      windowSeconds: 60,
      maxCount: 3,
      hashIdentifier: true,
    });
    if (rlLiff.limited) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: "応募回数が多すぎます。しばらく待ってから再度お試しください。",
        },
        { status: 429 },
      );
    }
  }

  // H2 修正: lineChannelId が body 由来 で 攻撃者 が 別 の 自 Channel 経由 で
  // 被害 組織 に inbound を 注入 できる の を 塞ぐ。 line_channels を 参照 し、
  // 「organization_id = orgId かつ line_channel_id = lineChannelId かつ is_active」
  // で 一致 確認 が 通ら なけ れ ば 401。
  const admin = createServiceClient();
  const { data: channelRow } = await admin
    .from("line_channels")
    .select("id, is_active")
    .eq("organization_id", orgId)
    .eq("line_channel_id", lineChannelId)
    .maybeSingle();
  if (!channelRow || !(channelRow as { is_active: boolean }).is_active) {
    return NextResponse.json({ error: "channel_org_mismatch" }, { status: 401 });
  }
  // job_postings の 組織一致 を 確認
  const { data: jobRow } = await admin
    .from("job_postings")
    .select("id, organization_id, status, company_name, position")
    .eq("id", jobId)
    .eq("organization_id", orgId)
    .maybeSingle();
  type JobRow = {
    id: string;
    organization_id: string;
    status: string;
    company_name: string;
    position: string;
  };
  const job = jobRow as JobRow | null;
  if (!job || job.status !== "open") {
    return NextResponse.json({ error: "job_not_open" }, { status: 404 });
  }

  // line_user_links を upsert (LIFF 経由 で 自動 友達 化 する 場合 が ある)
  const { data: existingLink } = await admin
    .from("line_user_links")
    .select("client_record_id")
    .eq("organization_id", orgId)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const existingClientRecordId =
    (existingLink as { client_record_id: string | null } | null)?.client_record_id ?? null;

  if (!existingLink) {
    await admin.from("line_user_links").insert({
      organization_id: orgId,
      line_user_id: lineUserId,
      display_name: lineDisplayName,
      link_method: "liff_login",
      linked_at: new Date().toISOString(),
    });
  }

  // 応募 内容 を 1 メッセージ に まとめ、 line_messages の system event として 残す
  const summary = [
    `求職者 が LIFF から 応募 を 希望:`,
    `求人: ${job.position} (${job.company_name})`,
    comment ? `コメント: ${comment}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  await admin.from("line_messages").insert({
    organization_id: orgId,
    line_user_id: lineUserId,
    direction: "inbound",
    message_type: "system",
    encrypted_content: (await encryptField(summary)) ?? null,
    related_job_id: jobId,
    client_record_id: existingClientRecordId,
  });

  // 通知 fan-out
  try {
    await notifyAgencyOfLineMessage({
      organizationId: orgId,
      lineUserId,
      senderDisplayName: lineDisplayName,
      clientName: null,
      preview: `LIFF 応募: ${job.position} (${job.company_name})${comment ? ` — ${comment.slice(0, 30)}` : ""}`,
      messageType: "system",
    });
  } catch (err) {
    console.warn("[liff/applications] notify failed", err);
  }

  return NextResponse.json({ ok: true });
}
