import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/api/auth-guards";
import { getSharedInterviewPrepForSeeker } from "@/lib/interview-preps/queries";

/**
 * /app/interview-prep/[referralId]
 *
 * 求職者本人向け:1 件の共有済み面談対策の詳細(本文込み)。
 *
 * 認可は lib/interview-preps/queries.ts の getSharedInterviewPrepForSeeker に集約:
 *   1. requireUser
 *   2. referral → client_record の linked_user_id 一致 かつ linked
 *   3. interview_preps.shared_at not null
 *   4. いずれか欠ければ null → notFound()(他人の存在を隠す)
 */
type RouteParams = { params: Promise<{ referralId: string }> };

/** 共有日時を Asia/Tokyo で "YYYY/MM/DD HH:mm" 表示。 */
function formatJst(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default async function SeekerInterviewPrepDetailPage({ params }: RouteParams) {
  const { referralId } = await params;
  const guard = await requireUser();
  if (!guard.ok) return null;

  const prep = await getSharedInterviewPrepForSeeker(referralId, guard.user.id);
  if (!prep) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/app/interview-prep" />}>
          ← 一覧へ戻る
        </Button>
      </div>

      <div>
        <div className="text-muted-foreground mb-1 text-xs">
          {prep.organizationName} ・ {prep.jobLabel}
          {prep.sharedAt && <> ・ {formatJst(prep.sharedAt)} 共有</>}
        </div>
        <h1 className="text-2xl font-bold">面談対策</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          担当エージェントがあなたのために作成した面談対策です。内容は AI
          による提案を含みます。事前に事実確認のうえご活用ください。
        </p>
      </div>

      {prep.content.sections.length === 0 ? (
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">内容がまだありません。</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {prep.content.sections.map((section, idx) => (
            <Card key={idx} className="border-border/70 bg-muted/20 p-4">
              <h2 className="mb-2.5 flex items-center gap-2 text-[0.95rem] leading-snug font-semibold">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-xs font-bold text-white">
                  {idx + 1}
                </span>
                {section.heading}
              </h2>
              <ul className="space-y-2.5 text-sm leading-relaxed">
                {section.items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-orange-500"
                      aria-hidden
                    />
                    <span className="whitespace-pre-wrap">{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        内容に不明点があれば、担当エージェントにご相談ください。
      </p>
    </div>
  );
}
