/**
 * platform_announcements の取得 / 作成 / 既読更新ヘルパ
 *
 * - 取得:RLS が「公開期間内 + 対象 org メンバー or 運営者」を担保
 * - 既読:本人のみ自分の行を作成
 * - 作成:RLS が運営者のみを担保
 */
import { createClient } from "@/lib/supabase/server";

import type {
  CreatePlatformAnnouncementInput,
  PlatformAnnouncement,
  PlatformAnnouncementCategory,
  PlatformAnnouncementTargetType,
} from "./platform-types";

type Raw = {
  id: string;
  created_by: string | null;
  title: string;
  body: string;
  category: PlatformAnnouncementCategory;
  target_type: PlatformAnnouncementTargetType;
  target_organization_ids: string[];
  published_at: string;
  expires_at: string | null;
  is_pinned: boolean;
  require_ack: boolean;
  cta_label: string | null;
  cta_url: string | null;
  created_at: string;
  updated_at: string;
};
type RawWithRead = Raw & {
  platform_announcement_reads:
    | { read_at: string; acknowledged_at: string | null }
    | { read_at: string; acknowledged_at: string | null }[]
    | null;
};

function readShape(r: RawWithRead["platform_announcement_reads"]): {
  readAt: string | null;
  acknowledgedAt: string | null;
} {
  if (!r) return { readAt: null, acknowledgedAt: null };
  const x = Array.isArray(r) ? (r[0] ?? null) : r;
  if (!x) return { readAt: null, acknowledgedAt: null };
  return { readAt: x.read_at, acknowledgedAt: x.acknowledged_at };
}

function shape(r: RawWithRead): PlatformAnnouncement {
  const reads = readShape(r.platform_announcement_reads);
  return {
    id: r.id,
    createdBy: r.created_by,
    title: r.title,
    body: r.body,
    category: r.category,
    targetType: r.target_type,
    targetOrganizationIds: r.target_organization_ids,
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
    isPinned: r.is_pinned,
    requireAck: r.require_ack,
    ctaLabel: r.cta_label,
    ctaUrl: r.cta_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    readAt: reads.readAt,
    acknowledgedAt: reads.acknowledgedAt,
  };
}

/**
 * 自分宛て(エージェントとして見える)お知らせ一覧。
 * - pinned が先頭、その後 publishedAt 降順
 * - read 状態を join して返す(本人の既読のみ抽出)
 * - includeRead=false なら未読のみ
 */
export async function listMyPlatformAnnouncements(
  options: {
    includeRead?: boolean;
    limit?: number;
  } = {},
): Promise<PlatformAnnouncement[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("platform_announcements")
    .select(
      "id, created_by, title, body, category, target_type, target_organization_ids, published_at, expires_at, is_pinned, require_ack, cta_label, cta_url, created_at, updated_at, platform_announcement_reads!left(read_at, acknowledged_at)",
    )
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (error) {
    throw new Error(`listMyPlatformAnnouncements failed: ${error.message}`);
  }

  let items = ((data ?? []) as RawWithRead[]).map(shape);
  if (options.includeRead === false) {
    items = items.filter((a) => a.readAt === null);
  }
  return items;
}

/** 未読件数(ダッシュボードバッジ用) */
export async function countUnreadPlatformAnnouncements(): Promise<number> {
  const items = await listMyPlatformAnnouncements({ includeRead: false, limit: 100 });
  return items.length;
}

/**
 * 既読化(insert if not exists、ack のときは acknowledged_at もセット可)
 */
export async function markPlatformAnnouncementRead(args: {
  announcementId: string;
  acknowledge?: boolean;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const row: {
    announcement_id: string;
    user_id: string;
    read_at: string;
    acknowledged_at?: string;
  } = {
    announcement_id: args.announcementId,
    user_id: user.id,
    read_at: new Date().toISOString(),
  };
  if (args.acknowledge) row.acknowledged_at = row.read_at;

  const { error } = await supabase
    .from("platform_announcement_reads")
    .upsert(row, { onConflict: "announcement_id,user_id" });
  if (error) {
    throw new Error(`markPlatformAnnouncementRead failed: ${error.message}`);
  }
}

/** 運営者向け:全件取得(public + 期限切れ + 下書きも) */
export async function listAllPlatformAnnouncementsForAdmin(): Promise<PlatformAnnouncement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_announcements")
    .select(
      "id, created_by, title, body, category, target_type, target_organization_ids, published_at, expires_at, is_pinned, require_ack, cta_label, cta_url, created_at, updated_at",
    )
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`listAllPlatformAnnouncementsForAdmin failed: ${error.message}`);
  }
  return ((data ?? []) as Raw[]).map((r) => shape({ ...r, platform_announcement_reads: null }));
}

/** 運営者向け:作成 */
export async function createPlatformAnnouncement(
  input: CreatePlatformAnnouncementInput,
): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("platform_announcements")
    .insert({
      created_by: user.id,
      title: input.title,
      body: input.body,
      category: input.category,
      target_type: input.targetType,
      target_organization_ids: input.targetOrganizationIds,
      published_at: input.publishedAt ?? new Date().toISOString(),
      expires_at: input.expiresAt ?? null,
      is_pinned: input.isPinned,
      require_ack: input.requireAck,
      cta_label: input.ctaLabel || null,
      cta_url: input.ctaUrl || null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createPlatformAnnouncement failed: ${error?.message ?? "unknown"}`);
  }
  return data.id as string;
}

/** 運営者向け:削除 */
export async function deletePlatformAnnouncement(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("platform_announcements").delete().eq("id", id);
  if (error) {
    throw new Error(`deletePlatformAnnouncement failed: ${error.message}`);
  }
}

/** 運営者判定 */
export async function isMairaAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("is_maira_admin")
    .eq("id", user.id)
    .maybeSingle();
  return !!(data as { is_maira_admin?: boolean } | null)?.is_maira_admin;
}
