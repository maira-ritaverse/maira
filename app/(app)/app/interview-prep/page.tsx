import Link from "next/link";

import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/api/auth-guards";
import { listSharedInterviewPrepsForSeeker } from "@/lib/interview-preps/queries";

/** 共有日を Asia/Tokyo で "YYYY/MM/DD" 表示(サーバー TZ に依存しないよう明示指定)。 */
function formatJstDate(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * /app/interview-prep
 *
 * 求職者本人向け:エージェントが自分のために作成し「共有」した面接対策の一覧。
 * 共有済み(shared_at not null)のもののみ表示する。
 *
 * recommendation-letters の求職者ページと同じ作法。クエリロジックは
 * lib/interview-preps/queries.ts に集約(service client + 手動認可 + 復号)。
 */
export default async function SeekerInterviewPrepListPage() {
  const guard = await requireUser();
  if (!guard.ok) {
    // requireUser はレイアウト側で先に弾いている前提なので通常ここには来ない
    return null;
  }
  const preps = await listSharedInterviewPrepsForSeeker(guard.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">面接対策</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          担当エージェントがあなたの選考のために作成した面接対策です。共有されたもののみ表示されます。
        </p>
      </div>

      {preps.length === 0 ? (
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">
            まだ共有された面接対策はありません。担当エージェントが作成・共有すると、ここに表示されます。
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {preps.map((p) => (
            <Link key={p.referralId} href={`/app/interview-prep/${p.referralId}`} className="block">
              <Card className="hover:bg-accent/40 p-4 transition-colors">
                <div className="text-muted-foreground mb-1 text-xs">
                  {p.organizationName} ・ {p.jobLabel}
                  {p.sharedAt && <> ・ {formatJstDate(p.sharedAt)} 共有</>}
                </div>
                <div className="text-foreground line-clamp-2 text-sm font-medium">
                  {p.firstHeading || "面接対策"}
                  {p.sectionCount > 1 && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      ほか {p.sectionCount - 1} 項目
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
