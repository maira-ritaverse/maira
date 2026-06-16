import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listSeekerDocumentDrafts } from "@/lib/doc-drafts/queries";
import { DOCUMENT_DRAFT_STATUS_LABEL, DOCUMENT_DRAFT_TYPE_LABEL } from "@/lib/doc-drafts/types";
import { createClient } from "@/lib/supabase/server";

import { DraftActionButtons } from "./draft-action-buttons";

/**
 * /app/agent-drafts
 *
 * 求職者向け:エージェントから提出された書類ドラフトの受信箱。
 * - 履歴書 / 職務経歴書の下書きを一覧で表示
 * - submitted は「受領」「辞退」アクション可
 * - accepted は既に取り込み済みの表示
 */
export default async function AgentDraftsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const drafts = await listSeekerDocumentDrafts();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/app" className="hover:underline">
            ← ダッシュボード
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">エージェントからの書類</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          エージェントが作成した履歴書・職務経歴書の下書きです。内容を確認して
          受領するか辞退するかを選んでください。
        </p>
      </div>

      {drafts.length === 0 && (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          現在、エージェントから届いている書類はありません。
        </Card>
      )}

      {drafts.length > 0 && (
        <ul className="space-y-3">
          {drafts.map((d) => (
            <Card key={d.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{d.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {d.organizationName} 経由 ・ {DOCUMENT_DRAFT_TYPE_LABEL[d.documentType]}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    d.status === "submitted"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                      : d.status === "accepted"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {DOCUMENT_DRAFT_STATUS_LABEL[d.status]}
                </span>
              </div>

              {d.message && (
                <p className="bg-muted/40 text-muted-foreground rounded-md p-2 text-xs">
                  💬 {d.message}
                </p>
              )}

              {d.payload?.motivation_note && (
                <DetailBlock title="志望動機メモ" body={d.payload.motivation_note} />
              )}
              {d.payload?.self_pr && <DetailBlock title="自己 PR" body={d.payload.self_pr} />}

              <p className="text-muted-foreground text-[10px]">
                受領日:{new Date(d.createdAt).toLocaleString("ja-JP")}
              </p>

              {d.status === "submitted" && <DraftActionButtons draftId={d.id} />}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-[11px]">{title}</p>
      <p className="line-clamp-4 text-xs whitespace-pre-wrap">{body}</p>
    </div>
  );
}
