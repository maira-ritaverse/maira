/**
 * Maira 運営 → エージェンシーへの「お知らせ」型定義
 *
 * 既存 lib/notifications(in-app 通知)とは別レイヤー:
 *   - notifications:アクション派生(referral 状態変化など)
 *   - platform_announcements:運営からの計画的な掲示物(メンテ告知・新機能告知 etc)
 */
import { z } from "zod";

export const PLATFORM_ANNOUNCEMENT_CATEGORIES = [
  "info",
  "maintenance",
  "important",
  "promotion",
  "feature",
] as const;
export type PlatformAnnouncementCategory = (typeof PLATFORM_ANNOUNCEMENT_CATEGORIES)[number];

export const PLATFORM_CATEGORY_LABEL: Record<PlatformAnnouncementCategory, string> = {
  info: "お知らせ",
  maintenance: "メンテナンス",
  important: "重要",
  promotion: "キャンペーン",
  feature: "新機能",
};

export const PLATFORM_CATEGORY_ICON: Record<PlatformAnnouncementCategory, string> = {
  info: "📣",
  maintenance: "🛠",
  important: "❗",
  promotion: "🎁",
  feature: "✨",
};

/** カテゴリ → タイトルバー Tailwind クラス(UI 側で利用) */
export const PLATFORM_CATEGORY_CLASS: Record<PlatformAnnouncementCategory, string> = {
  info: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100",
  maintenance: "bg-slate-200 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100",
  important: "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-100",
  promotion: "bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-100",
  feature: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
};

export type PlatformAnnouncementTargetType = "all" | "specific";

export type PlatformAnnouncement = {
  id: string;
  createdBy: string | null;
  title: string;
  body: string;
  category: PlatformAnnouncementCategory;
  targetType: PlatformAnnouncementTargetType;
  targetOrganizationIds: string[];
  publishedAt: string;
  expiresAt: string | null;
  isPinned: boolean;
  requireAck: boolean;
  ctaLabel: string | null;
  ctaUrl: string | null;
  createdAt: string;
  updatedAt: string;
  // 取得時に join される
  readAt?: string | null;
  acknowledgedAt?: string | null;
};

/**
 * 作成リクエスト schema(POST /api/admin/announcements で受ける)
 */
export const createPlatformAnnouncementSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(10000),
    category: z.enum(PLATFORM_ANNOUNCEMENT_CATEGORIES).default("info"),
    targetType: z.enum(["all", "specific"]).default("all"),
    targetOrganizationIds: z.array(z.string().uuid()).default([]),
    publishedAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    isPinned: z.boolean().default(false),
    requireAck: z.boolean().default(false),
    ctaLabel: z.string().max(50).nullable().optional(),
    ctaUrl: z.string().url().nullable().optional().or(z.literal("")),
  })
  .refine(
    (v) =>
      v.targetType === "all" || (v.targetType === "specific" && v.targetOrganizationIds.length > 0),
    {
      message: "targetType=specific のときは targetOrganizationIds が 1 件以上必要です",
      path: ["targetOrganizationIds"],
    },
  )
  .refine((v) => !v.ctaLabel || !!v.ctaUrl, {
    message: "CTA ラベルを設定する場合は CTA URL も必須です",
    path: ["ctaUrl"],
  });
export type CreatePlatformAnnouncementInput = z.infer<typeof createPlatformAnnouncementSchema>;
