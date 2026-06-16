import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { rowToAnnouncement, type Announcement } from "@/lib/announcements/types";

import { AnnouncementsClient } from "./announcements-client";

/**
 * 組織内お知らせ一覧
 *
 * - admin:作成 / 編集 / 削除
 * - 全メンバー:閲覧 + 既読マーク
 */
export default async function AnnouncementsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const [annRes, readRes] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .eq("organization_id", role.organization.id)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("announcement_reads").select("announcement_id").eq("member_id", role.member.id),
  ]);

  const reads = new Set<string>(
    ((readRes.data ?? []) as Array<{ announcement_id: string }>).map((r) => r.announcement_id),
  );
  const announcements: (Announcement & { isRead: boolean })[] = (
    (annRes.data ?? []) as Parameters<typeof rowToAnnouncement>[0][]
  )
    .map(rowToAnnouncement)
    .map((a) => ({ ...a, isRead: reads.has(a.id) }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">お知らせ</h1>
        <p className="text-muted-foreground mt-1 text-sm">組織内の連絡事項を一元管理します</p>
      </div>
      <AnnouncementsClient
        initialAnnouncements={announcements}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
