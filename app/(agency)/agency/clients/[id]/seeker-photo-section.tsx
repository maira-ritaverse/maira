import Link from "next/link";

import { getLinkedSeekerLatestPhoto } from "@/lib/agency/seeker-photo";

type Props = {
  /** linked クライアントの linked_user_id(unlinked のときは渡さない想定) */
  linkedUserId: string | null;
  clientRecordId: string;
};

/**
 * 求職者の証明写真を CRM に表示するセクション。
 *
 * 表示パターン:
 *   - linked + 写真あり:写真 + ベース履歴書へのリンク
 *   - linked + 写真なし:プレースホルダ + 「履歴書一覧」リンク
 *   - unlinked:何も表示しない(呼び出し側 page.tsx で sections マップが null を返す)
 *
 * 写真は履歴書から自動取り込み(本人が /app/resumes/[id]/photo で登録した写真)。
 * 署名 URL は 60 分有効。ページを開き直すと再発行される。
 */
export async function SeekerPhotoSection({ linkedUserId, clientRecordId }: Props) {
  if (!linkedUserId) return null;
  const photo = await getLinkedSeekerLatestPhoto(linkedUserId);

  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
      <div className="border-input bg-muted/30 relative aspect-3/4 w-32 shrink-0 overflow-hidden rounded-md border">
        {photo ? (
          // 履歴書写真は 450x600(縦長 3:4)で保存されている前提
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.signedUrl}
            alt="求職者の証明写真"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center text-center text-xs">
            写真
            <br />
            未登録
          </div>
        )}
      </div>
      <div className="space-y-1 text-xs">
        {photo ? (
          <>
            <p className="text-foreground text-sm font-medium">{photo.resumeTitle}</p>
            <p className="text-muted-foreground">
              更新:{new Date(photo.resumeUpdatedAt).toLocaleDateString("ja-JP")}
            </p>
            <p className="text-muted-foreground">
              本人が履歴書から登録した写真です(60 分有効の署名 URL で表示)。
            </p>
            <Link
              href={`/agency/clients/${clientRecordId}/resumes/${photo.resumeId}`}
              className="text-foreground inline-block underline-offset-4 hover:underline"
            >
              履歴書を開く →
            </Link>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">求職者は履歴書に証明写真を登録していません。</p>
            <p className="text-muted-foreground text-[11px]">
              本人が <code className="bg-muted px-1">履歴書 → 写真をアップロード</code> 又は{" "}
              <code className="bg-muted px-1">AI で証明写真にする</code> で登録すると、
              ここに表示されます。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
