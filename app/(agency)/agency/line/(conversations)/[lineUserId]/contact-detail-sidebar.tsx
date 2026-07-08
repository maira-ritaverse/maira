import Link from "next/link";

import { ActivitySection } from "./activity-section";
import { AssigneeSection } from "./assignee-section";
import { CreateClientButton } from "./create-client-button";
import { DisplayNameEditor } from "./display-name-editor";
import { NotesSection } from "./notes-section";
import { ProfileRefreshButton } from "./profile-refresh-button";
import { TagsSection } from "./tags-section";

/**
 * 右 サイドバー:選択中 友達 の 連絡先 詳細
 *
 * LINE OA Manager 風 の デザイン に 合わせて:
 *   ・大きめ アバター + 名前
 *   ・ノート / 利用履歴 タブ (現状は ノート プレースホルダ)
 *   ・クライアント 紐付け / 紐付け方法 / 友達追加日
 *
 * 後日 拡張 予定:
 *   ・ノート (内部メモ、 暗号化)
 *   ・タグ (組織内 分類)
 *   ・担当者 (organization_member)
 *   ・利用履歴 (求人 興味あり / 応募 / 面談 等 の タイムライン)
 */
type Props = {
  lineUserId: string;
  displayName: string | null;
  /** エージェント が 上書き した 名前 (null なら displayName を 使う) */
  customName: string | null;
  pictureUrl: string | null;
  clientRecordId: string | null;
  clientName: string | null;
  linkMethod: "manual" | "code" | "liff_login" | null;
  unfollowedAt: string | null;
  createdAt: string;
  assigneeUserId: string | null;
  memberOptions: Array<{ userId: string; displayName: string; avatarUrl: string | null }>;
};

export function ContactDetailSidebar({
  lineUserId,
  displayName,
  customName,
  pictureUrl,
  clientRecordId,
  clientName,
  linkMethod,
  unfollowedAt,
  createdAt,
  assigneeUserId,
  memberOptions,
}: Props) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l bg-white lg:flex">
      {/* プロフィール */}
      <div className="border-b px-4 py-5 text-center">
        {pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pictureUrl}
            alt=""
            className="mx-auto h-20 w-20 rounded-full bg-slate-200 object-cover"
          />
        ) : (
          <div className="mx-auto h-20 w-20 rounded-full bg-slate-200" />
        )}
        <div className="mt-3">
          <DisplayNameEditor
            lineUserId={lineUserId}
            displayName={displayName}
            customName={customName}
          />
        </div>
        <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
          {lineUserId.slice(0, 16)}...
        </p>
        <ProfileRefreshButton lineUserId={lineUserId} />
      </div>

      {/* メタ 情報 */}
      <div className="space-y-3 border-b px-4 py-4 text-xs">
        <Row label="紐付け">
          {clientRecordId ? (
            <Link
              href={`/agency/clients/${clientRecordId}`}
              className="font-semibold text-emerald-700 underline hover:text-emerald-800"
            >
              {clientName ?? "(クライアント名なし)"}
            </Link>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <span className="text-muted-foreground">未紐付け</span>
              <CreateClientButton lineUserId={lineUserId} displayName={customName ?? displayName} />
            </div>
          )}
        </Row>
        {linkMethod && <Row label="紐付け方法">{linkMethodLabel(linkMethod)}</Row>}
        <Row label="友達追加日">{new Date(createdAt).toLocaleDateString("ja-JP")}</Row>
        {unfollowedAt && (
          <Row label="解除日">
            <span className="text-amber-700">
              {new Date(unfollowedAt).toLocaleDateString("ja-JP")}
            </span>
          </Row>
        )}
      </div>

      {/* 担当者 */}
      <AssigneeSection
        lineUserId={lineUserId}
        initialAssigneeUserId={assigneeUserId}
        members={memberOptions}
      />

      {/* タグ */}
      <TagsSection lineUserId={lineUserId} />

      {/* ノート */}
      <NotesSection lineUserId={lineUserId} />

      {/* 利用履歴 */}
      <ActivitySection lineUserId={lineUserId} />
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function linkMethodLabel(m: "manual" | "code" | "liff_login"): string {
  return m === "manual" ? "手動 紐付け" : m === "code" ? "連携コード" : "LIFF ログイン";
}
