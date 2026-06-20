import Link from "next/link";

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
  pictureUrl: string | null;
  clientRecordId: string | null;
  clientName: string | null;
  linkMethod: "manual" | "code" | "liff_login" | null;
  unfollowedAt: string | null;
  createdAt: string;
};

export function ContactDetailSidebar({
  lineUserId,
  displayName,
  pictureUrl,
  clientRecordId,
  clientName,
  linkMethod,
  unfollowedAt,
  createdAt,
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
        <p className="mt-3 text-sm font-semibold">{displayName ?? "(名前なし)"}</p>
        <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
          {lineUserId.slice(0, 16)}...
        </p>
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
            <span className="text-muted-foreground">未紐付け</span>
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

      {/* ノート (プレースホルダ、 後日 実装) */}
      <div className="space-y-2 border-b px-4 py-4">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold">ノート</p>
          <span className="text-muted-foreground text-[10px]">準備中</span>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-[11px] text-slate-600">
          <p className="font-semibold">相手 と の やりとり を 記録 できます</p>
          <p className="text-muted-foreground mt-1 leading-relaxed">
            相手 の 情報 や 対応 の 記録、 引き継ぎ用 メモ などを 追加 できる ように なります。
            (内部メモ。 相手 には 見えません)
          </p>
        </div>
      </div>

      {/* 利用履歴 (プレースホルダ、 後日 実装) */}
      <div className="space-y-2 px-4 py-4">
        <p className="text-xs font-semibold">利用履歴</p>
        <p className="text-muted-foreground text-[11px]">
          求人 興味 / 応募 / 面談 の タイムライン を 表示 (準備中)
        </p>
      </div>
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
