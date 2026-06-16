"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PLATFORM_ANNOUNCEMENT_CATEGORIES,
  PLATFORM_CATEGORY_ICON,
  PLATFORM_CATEGORY_LABEL,
  type PlatformAnnouncementCategory,
  type PlatformAnnouncementTargetType,
} from "@/lib/announcements/platform-types";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 運営者向け:お知らせ作成フォーム。
 *
 * 全項目をフロントで作る:
 *   - タイトル / 本文 / カテゴリ
 *   - 対象(全エージェント or 特定組織 ID のカンマ区切り入力)
 *   - 公開期間(開始 / 期限)
 *   - is_pinned / require_ack トグル
 *   - CTA ラベル / URL(任意ペア)
 */
export function AnnouncementCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<PlatformAnnouncementCategory>("info");
  const [targetType, setTargetType] = useState<PlatformAnnouncementTargetType>("all");
  const [targetOrganizationIds, setTargetOrganizationIds] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [requireAck, setRequireAck] = useState(false);
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const orgIds = targetOrganizationIds
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await apiFetch("/api/admin/announcements", {
        method: "POST",
        json: {
          title,
          body,
          category,
          targetType,
          targetOrganizationIds: targetType === "specific" ? orgIds : [],
          publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          isPinned,
          requireAck,
          ctaLabel: ctaLabel || null,
          ctaUrl: ctaUrl || null,
        },
      });
      // 成功:フォームリセット + 一覧再描画
      setTitle("");
      setBody("");
      setCategory("info");
      setTargetType("all");
      setTargetOrganizationIds("");
      setPublishedAt("");
      setExpiresAt("");
      setIsPinned(false);
      setRequireAck(false);
      setCtaLabel("");
      setCtaUrl("");
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-semibold">新規お知らせ作成</h2>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="title">タイトル</Label>
          <Input
            id="title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例:6 月 30 日 メンテナンスのお知らせ"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="body">本文</Label>
          <Textarea
            id="body"
            required
            rows={4}
            maxLength={10000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="改行可。詳細を記入してください。"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="category">カテゴリ</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as PlatformAnnouncementCategory)}
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              {PLATFORM_ANNOUNCEMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PLATFORM_CATEGORY_ICON[c]} {PLATFORM_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="targetType">配信対象</Label>
            <select
              id="targetType"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as PlatformAnnouncementTargetType)}
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              <option value="all">全エージェント</option>
              <option value="specific">特定の企業のみ</option>
            </select>
          </div>
        </div>

        {targetType === "specific" && (
          <div className="space-y-1">
            <Label htmlFor="targetOrganizationIds">
              対象 organization.id(カンマ または 改行区切り)
            </Label>
            <Textarea
              id="targetOrganizationIds"
              rows={2}
              value={targetOrganizationIds}
              onChange={(e) => setTargetOrganizationIds(e.target.value)}
              placeholder="例:00000000-0000-0000-0000-000000000000, ..."
            />
            <p className="text-muted-foreground text-[11px]">
              将来 UI で企業を選択できるようにしますが、現状は ID を直接貼り付けてください。
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="publishedAt">掲出開始(任意、未指定で即時)</Label>
            <Input
              id="publishedAt"
              type="datetime-local"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="expiresAt">掲出終了(任意)</Label>
            <Input
              id="expiresAt"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
            />
            <span>📌 上部に固定(pinned)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={requireAck}
              onChange={(e) => setRequireAck(e.target.checked)}
            />
            <span>承認必須(押すまで dismiss できない)</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ctaLabel">CTA ラベル(任意)</Label>
            <Input
              id="ctaLabel"
              maxLength={50}
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              placeholder="例:詳細を見る"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ctaUrl">CTA URL(任意)</Label>
            <Input
              id="ctaUrl"
              type="url"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "作成中…" : "作成して配信"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
