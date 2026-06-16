import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { createAnnouncementSchema, rowToAnnouncement } from "@/lib/announcements/types";

/**
 * /api/agency/announcements
 *   GET  - 組織のお知らせ一覧(pinned 優先 + 新しい順)+ 既読フラグ
 *   POST - 新規作成(admin 限定)
 *
 * 認証 / 認可は lib/api/auth-guards のヘルパに集約。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member } = guard;

  const [annRes, readRes] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .eq("organization_id", organization.id)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("announcement_reads").select("announcement_id").eq("member_id", member.id),
  ]);

  if (annRes.error) {
    return NextResponse.json(
      { error: "Failed to load", message: annRes.error.message },
      { status: 500 },
    );
  }
  const reads = new Set<string>(
    ((readRes.data ?? []) as Array<{ announcement_id: string }>).map((r) => r.announcement_id),
  );
  const announcements = ((annRes.data ?? []) as Parameters<typeof rowToAnnouncement>[0][])
    .map(rowToAnnouncement)
    .map((a) => ({ ...a, isRead: reads.has(a.id) }));
  return NextResponse.json({ announcements });
}

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = createAnnouncementSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("announcements")
    .insert({
      organization_id: organization.id,
      title: parsed.data.title.trim(),
      body: parsed.data.body,
      is_pinned: parsed.data.isPinned,
      created_by_member_id: member.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { announcement: rowToAnnouncement(data as Parameters<typeof rowToAnnouncement>[0]) },
    { status: 201 },
  );
}
