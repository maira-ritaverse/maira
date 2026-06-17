import { Pin } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { listAllPlatformAnnouncementsForAdmin } from "@/lib/announcements/platform-queries";
import {
  PLATFORM_CATEGORY_LABEL,
  type PlatformAnnouncement,
} from "@/lib/announcements/platform-types";

import { AnnouncementCreateForm } from "./create-form";
import { AnnouncementRowActions } from "./row-actions";

/**
 * 運営者向け:お知らせ一覧 + 新規作成フォーム。
 * RLS で運営者でなければ listAll は空 / forbidden になる。layout で gate 済。
 */
export default async function AdminAnnouncementsPage() {
  let items: PlatformAnnouncement[] = [];
  try {
    items = await listAllPlatformAnnouncementsForAdmin();
  } catch {
    items = [];
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/admin" className="hover:underline">
            ← 運営管理
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">お知らせ管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          エージェント企業向けに公開するお知らせを作成・管理します。
        </p>
      </div>

      <AnnouncementCreateForm />

      <Card className="space-y-2 p-5">
        <h2 className="text-base font-semibold">過去のお知らせ({items.length} 件)</h2>
        {items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">まだ作成されていません。</p>
        ) : (
          <ul className="divide-foreground/10 divide-y text-sm">
            {items.map((a) => {
              const expired = a.expiresAt && new Date(a.expiresAt) < new Date();
              return (
                <li key={a.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="bg-muted rounded px-1.5 py-0.5">
                          {PLATFORM_CATEGORY_LABEL[a.category]}
                        </span>
                        <span className="text-muted-foreground">
                          {a.targetType === "all"
                            ? "全エージェント宛"
                            : `特定 ${a.targetOrganizationIds.length} 社宛`}
                        </span>
                        {a.isPinned && (
                          <span className="inline-flex items-center gap-1">
                            <Pin className="h-3 w-3" />
                            固定
                          </span>
                        )}
                        {a.requireAck && <span>要承認</span>}
                        {expired && <span className="text-muted-foreground">期限切れ</span>}
                      </div>
                      <p className="font-medium">{a.title}</p>
                      <p className="text-muted-foreground line-clamp-2 text-xs whitespace-pre-wrap">
                        {a.body}
                      </p>
                      <p className="text-muted-foreground text-[10px]">
                        公開:{new Date(a.publishedAt).toLocaleString("ja-JP")}
                        {a.expiresAt && ` / 期限:${new Date(a.expiresAt).toLocaleString("ja-JP")}`}
                      </p>
                    </div>
                    <AnnouncementRowActions id={a.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
