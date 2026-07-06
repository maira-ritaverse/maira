/**
 * CRM 顧客 詳細 の LINE ステータス セクション (Server Component)。
 *
 * 連携 済み:
 *   ・LINE 表示 名 + プロフィール 画像
 *   ・最終 活動 日 (last_activity_at)
 *   ・「LINE で メッセージ」 ボタン → /agency/line/[lineUserId] へ 遷移
 * 未 連携:
 *   ・「連携 コード を 発行」 ボタン
 *   ・発行 済み コード (24h) が あれば 表示 (LINK_CODE_PATTERN 6 桁)
 */
import Link from "next/link";
import { MessageCircle, Link2Off } from "lucide-react";

import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { LineLinkCodeButton } from "./line-link-code-button";

type Props = {
  clientRecordId: string;
  organizationId: string;
};

export async function LineStatusSection({ clientRecordId, organizationId }: Props) {
  const supabase = await createClient();

  const { data: linkRow } = await supabase
    .from("line_user_links")
    .select(
      "line_user_id, display_name, custom_name, picture_url, unfollowed_at, last_activity_at, handled_at",
    )
    .eq("organization_id", organizationId)
    .eq("client_record_id", clientRecordId)
    .maybeSingle();

  const link = linkRow as {
    line_user_id: string;
    display_name: string | null;
    custom_name: string | null;
    picture_url: string | null;
    unfollowed_at: string | null;
    last_activity_at: string | null;
    handled_at: string | null;
  } | null;

  if (!link) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Link2Off className="text-muted-foreground mt-0.5 h-5 w-5" aria-hidden />
          <div className="flex-1">
            <h2 className="text-base font-semibold">LINE 連携</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              この顧客は公式 LINE と 未連携です。連携コードを発行して顧客に LINE
              で送信してもらうと自動で紐付きます。
            </p>
            <div className="mt-3">
              <LineLinkCodeButton clientRecordId={clientRecordId} />
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const displayName = link.custom_name ?? link.display_name ?? "(名前なし)";
  const isBlocked = Boolean(link.unfollowed_at);

  // 3 日 連絡 なし の 判定 (バッジ 表示)。 Server Component なので Date は 1 回 だけ。
  // eslint-disable-next-line react-hooks/purity -- Server Component の 単発 レンダー で Date 参照 は 安全
  const nowMs = Date.now();
  let staleDays: number | null = null;
  if (link.last_activity_at && !link.handled_at && !isBlocked) {
    const days = Math.floor(
      (nowMs - new Date(link.last_activity_at).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days >= 3) staleDays = days;
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        {link.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={link.picture_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full bg-slate-200 object-cover"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-full bg-slate-200" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">LINE 連携</h2>
            {isBlocked ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                ブロック / 友達 解除
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                連携 済
              </span>
            )}
            {staleDays !== null && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                {staleDays}日 連絡 なし
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {displayName}
            {link.last_activity_at && (
              <span className="ml-2">
                最終 活動:{" "}
                {new Date(link.last_activity_at).toLocaleString("ja-JP", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </p>
          {!isBlocked && (
            <div className="mt-3">
              <Link
                href={`/agency/line/${encodeURIComponent(link.line_user_id)}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                LINE で メッセージ
              </Link>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
