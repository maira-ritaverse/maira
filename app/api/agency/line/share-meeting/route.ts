import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { buildMeetingProposalMessage } from "@/lib/line/flex";
import { markConversationHandled, sendMessages } from "@/lib/line/messaging";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/share-meeting
 *
 * 面談 日程候補 を LINE で 求職者 に 提案 する。
 * postback で 1 つ 選ばれたら Webhook 側 で Zoom 会議 を 作成 (Chunk 18 / 19)。
 *
 * 入力:
 *   ・lineUserId
 *   ・title (面談 タイトル、 例: "初回 面談")
 *   ・agenda (任意、 議題 = 暗号化)
 *   ・durationMinutes (5〜480)
 *   ・slots: ISO 開始時刻 の 配列 (最大 12 件)
 *   ・expiresInHours (任意、 デフォルト 168 = 7 日)
 *   ・introText (任意、 LINE で 表示 する 案内文)
 */
const bodySchema = z.object({
  lineUserId: z.string().min(1).max(64),
  title: z.string().min(1).max(100),
  agenda: z.string().max(2000).optional(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  slots: z.array(z.string().datetime()).min(1).max(12),
  expiresInHours: z.number().int().min(1).max(720).default(168),
  introText: z.string().max(500).optional(),
  /** 候補 選択 時 に 作成 する 会議 プロバイダ。 デフォルト Zoom (後方 互換) */
  provider: z.enum(["zoom", "google_meet"]).default("zoom"),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  const { data: linkRow } = await admin
    .from("line_user_links")
    .select("line_user_id, client_record_id, unfollowed_at")
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", input.lineUserId)
    .maybeSingle();
  const link = linkRow as {
    line_user_id: string;
    client_record_id: string | null;
    unfollowed_at: string | null;
  } | null;
  if (!link) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }
  if (link.unfollowed_at) {
    return NextResponse.json({ error: "line_user_unfollowed" }, { status: 409 });
  }

  // 候補 を {startsAt, endsAt} 形式 に 変換
  const candidates = input.slots.map((iso) => {
    const startsAt = new Date(iso);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60 * 1000);
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  });

  // 提案 行 を 作成 (期限切れ の 古い 行 は 残しておく — Chunk 20 で 失効 cron を 追加 検討)
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
  const encryptedAgenda = input.agenda ? await encryptField(input.agenda) : null;

  const { data: proposalRow, error: insErr } = await admin
    .from("line_meeting_proposals")
    .insert({
      organization_id: guard.organization.id,
      line_user_id: input.lineUserId,
      client_record_id: link.client_record_id,
      created_by_user_id: guard.user.id,
      title: input.title,
      encrypted_agenda: encryptedAgenda,
      duration_minutes: input.durationMinutes,
      candidates,
      expires_at: expiresAt.toISOString(),
      provider: input.provider,
    })
    .select("id")
    .single();
  if (insErr || !proposalRow) {
    return NextResponse.json(
      { error: "db_insert_failed", message: insErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const proposalId = (proposalRow as { id: string }).id;

  // LINE に 送信
  const introText =
    input.introText ??
    `「${input.title}」の 日程 を 以下 から お選び ください:\n所要時間 約 ${input.durationMinutes} 分`;

  const message = buildMeetingProposalMessage(proposalId, candidates, introText);

  const sendResult = await sendMessages(
    admin,
    guard.organization.id,
    input.lineUserId,
    channel.channelAccessToken,
    [message],
  );

  if (!sendResult.ok) {
    return NextResponse.json(
      { error: "send_failed", message: sendResult.reason, proposalId },
      { status: 502 },
    );
  }

  await markConversationHandled(admin, guard.organization.id, input.lineUserId, guard.user.id);

  return NextResponse.json({
    ok: true,
    proposalId,
    sendMethod: sendResult.sendMethod,
    candidateCount: candidates.length,
  });
}
