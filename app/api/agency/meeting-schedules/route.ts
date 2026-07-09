/**
 * POST /api/agency/meeting-schedules
 *
 * カレンダー 画面 か ら 「手動 会議 予定」 を 直接 作成 する ため の API。
 *
 * Zoom / Google Meet 連携 経由 で は なく、 provider = 'manual' で
 * meeting_schedules に レコード を 追加 する。 対面 面談、 電話 会議、
 * 備忘 用 の 予定 を 想定。
 *
 * 認証: organization_member のみ。 host_user_id は 呼び出し者 に 固定。
 * RLS: 「Host can insert meeting schedules」 ポリシー で host_user_id = auth.uid()
 *       が 保証 される。 organization_id も current_user_organization_id() と
 *       一致 が 必要。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { encryptField } from "@/lib/crypto/field-encryption";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

const createMeetingScheduleSchema = z.object({
  title: z.string().min(1).max(200),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  timezone: z.string().default("Asia/Tokyo").optional(),
  provider: z.enum(["zoom", "google_meet", "manual"]).default("manual"),
  join_url: z.string().url().nullable().optional(),
  client_record_id: z.string().uuid().nullable().optional(),
  invitee_email: z.string().email().nullable().optional(),
  invitee_name: z.string().max(100).nullable().optional(),
  agenda: z.string().max(2000).nullable().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createMeetingScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // starts_at < ends_at の 整合性 チェック
  if (new Date(d.starts_at).getTime() >= new Date(d.ends_at).getTime()) {
    return NextResponse.json(
      { error: "ends_at は starts_at より 後 で ある 必要 が あり ます" },
      { status: 400 },
    );
  }

  // 議題 は 機密 な ので 暗号化
  const encryptedAgenda = d.agenda ? await encryptField(d.agenda) : null;

  const { data: inserted, error } = await supabase
    .from("meeting_schedules")
    .insert({
      organization_id: role.organization.id,
      host_user_id: user.id,
      client_record_id: d.client_record_id ?? null,
      invitee_email: d.invitee_email ?? null,
      invitee_name: d.invitee_name ?? null,
      provider: d.provider,
      // manual の 場合 は 外部 ID 無し。 zoom/meet を 指定 された ら フロント 側 で
      // 別 途 実 会議 を 作成 する 想定 だ が、 今回 は manual 用 途 に 特化。
      external_meeting_id: null,
      join_url: d.join_url ?? null,
      title: d.title,
      encrypted_agenda: encryptedAgenda,
      starts_at: d.starts_at,
      ends_at: d.ends_at,
      timezone: d.timezone ?? "Asia/Tokyo",
      status: "scheduled",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "作成 に 失敗 しま した", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
