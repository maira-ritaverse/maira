import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listCvs } from "@/lib/cvs/queries";
import { listResumes } from "@/lib/resumes/queries";

/**
 * linked クライアントの書類一覧セクション(エージェント側)
 *
 * 取得経路:
 *   既存の listResumes(userId) / listCvs(userId) を、linkedUserId を渡して呼ぶ。
 *   関数自体は本人向けに作られていて user_id 等価で絞っているが、Phase 4 で
 *   resumes/cvs に追加した「linked かつ自組織」SELECT ポリシーにより、エージェント
 *   セッションでも linkedUserId の行に限り SELECT が通る。RLS で防御し、関数側の
 *   等価フィルタは追加の二重チェックとして機能する。
 *
 * 暗号化:
 *   listResumes / listCvs は decryptField(共有鍵)を通って復号する。サーバー鍵
 *   経路なので、エージェントセッションでも RLS が通れば復号できる(Phase 調査 B6
 *   の前提)。
 *
 * 失敗時:
 *   復号エラー時は mapResumeRow / mapCvRow が throw する設計のため、try/catch で
 *   サイレントに「取得できなかった」表示にする(他セクションの描画を巻き込まない)。
 */

type Props = {
  linkedUserId: string;
  clientRecordId: string;
};

export async function AgencyDocumentsSection({ linkedUserId, clientRecordId }: Props) {
  let resumes: { id: string; title: string; updatedAt: string }[] = [];
  let cvs: { id: string; title: string; updatedAt: string }[] = [];
  let hasError = false;

  try {
    const [r, c] = await Promise.all([listResumes(linkedUserId), listCvs(linkedUserId)]);
    resumes = r.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt }));
    cvs = c.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt }));
  } catch {
    // 復号失敗・接続エラーなど。書類本体やキーを露出させたくないので
    // 件数だけのフォールバック UI に倒す。
    hasError = true;
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">共有された書類</h2>
        <p className="text-muted-foreground text-xs">
          このクライアントがあなたのエージェント企業に開示している書類です。
        </p>
      </div>

      {hasError ? (
        <Card className="p-4">
          <p className="text-sm text-red-600">
            書類の取得に失敗しました。時間をおいて再度お試しください。
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {/* 履歴書 */}
          <Card className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-base font-semibold">履歴書</h3>
              <span className="text-muted-foreground text-xs">{resumes.length}件</span>
            </div>
            {resumes.length === 0 ? (
              <p className="text-muted-foreground text-sm">公開された履歴書はまだありません。</p>
            ) : (
              <ul className="space-y-2">
                {resumes.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="text-muted-foreground text-xs">
                        更新:{formatDate(r.updatedAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/agency/clients/${clientRecordId}/resumes/${r.id}`} />}
                    >
                      開く
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 職務経歴書 */}
          <Card className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-base font-semibold">職務経歴書</h3>
              <span className="text-muted-foreground text-xs">{cvs.length}件</span>
            </div>
            {cvs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                公開された職務経歴書はまだありません。
              </p>
            ) : (
              <ul className="space-y-2">
                {cvs.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="text-muted-foreground text-xs">
                        更新:{formatDate(c.updatedAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/agency/clients/${clientRecordId}/cvs/${c.id}`} />}
                    >
                      開く
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}
