import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listAgencyClientCvs } from "@/lib/agency-client-documents/queries";

import { AgencyCvNewButton } from "./agency-cv-new-button";

type Props = {
  organizationId: string;
  clientRecordId: string;
  clientName: string;
};

const STATUS_LABEL: Record<"draft" | "final", string> = {
  draft: "編集中",
  final: "確定済",
};

const STATUS_TONE: Record<"draft" | "final", string> = {
  draft: "bg-muted text-muted-foreground",
  final: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
};

export async function AgencyCvsSection({ organizationId, clientRecordId, clientName }: Props) {
  const items = await listAgencyClientCvs(clientRecordId, organizationId);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          エージェントが {clientName} さんに代わって作成・管理する職務経歴書です。
        </p>
        <AgencyCvNewButton clientRecordId={clientRecordId} />
      </div>

      {items.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-sm">
          まだ職務経歴書はありません。「+ 新規作成」から始めてください。
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id}>
              <Card className="hover:bg-accent/40 p-4 transition-colors">
                <Link
                  href={`/agency/clients/${clientRecordId}/agency-cvs/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{c.title}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[c.status]}`}
                      >
                        {STATUS_LABEL[c.status]}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {c.documentDate
                        ? new Date(c.documentDate).toLocaleDateString("ja-JP")
                        : "日付未設定"}
                      ・ 更新:{new Date(c.updatedAt).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" tabIndex={-1}>
                    開く
                  </Button>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
