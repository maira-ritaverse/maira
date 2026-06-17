"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { clientStatusLabels, type ClientRecordWithAssignee } from "@/lib/clients/types";
import type { JobPosting } from "@/lib/jobs/types";
import { rankMatches, type MatchReason } from "@/lib/matching/score";

type JobMatchingSectionProps = {
  job: JobPosting;
  /** 自社の active クライアント(完了 / 見送り は除外) */
  clients: ClientRecordWithAssignee[];
  /** 既にこの求人に応募済みの clientRecordIds */
  alreadyAppliedClientIds: ReadonlyArray<string>;
};

const REASON_LABEL: Record<MatchReason, string> = {
  location: "勤務地",
  salary: "年収",
  position: "職種",
  employment: "雇用形態",
};

const REASON_TONE: Record<MatchReason, string> = {
  location: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  salary: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  position: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  employment: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

/**
 * 求人詳細画面の「マッチする顧客」セクション(クライアント側マッチングの逆方向)。
 *
 * 既存の rankMatches を「1 つの求人 × N 顧客」の方向で再利用:
 *   - rankMatches は client 入力 + jobs 配列を受けるので、ループ + scoreMatch でも
 *     表現できるが、API を統一するために「1 client × 1 job array(1 件だけの配列)」
 *     を各 client に対して回す。
 *
 * トップ 10 件を表示。score 15 点未満は出さない。応募済みは除外。
 */
export function JobMatchingSection({
  job,
  clients,
  alreadyAppliedClientIds,
}: JobMatchingSectionProps) {
  const matches = useMemo(() => {
    const excluded = new Set(alreadyAppliedClientIds);
    const jobInput = {
      id: job.id,
      companyName: job.companyName,
      position: job.position,
      location: job.location,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      employmentType: job.employmentType,
    };
    // 各クライアントに対して 1 件配列の rankMatches を呼ぶことで結果型を統一
    const results = clients
      .filter((c) => !excluded.has(c.id))
      .map((c) => {
        const r = rankMatches(
          {
            desiredLocations: c.desiredLocations,
            desiredOccupations: c.desiredOccupations,
            desiredAnnualIncome: c.desiredAnnualIncome,
            currentEmploymentType: c.currentEmploymentType,
          },
          [jobInput],
          { topN: 1, minScore: 15 },
        );
        if (r.length === 0) return null;
        return { client: c, score: r[0].score, reasons: r[0].reasons };
      })
      .filter(
        (x): x is { client: ClientRecordWithAssignee; score: number; reasons: MatchReason[] } =>
          x !== null,
      );
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 10);
  }, [job, clients, alreadyAppliedClientIds]);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">マッチする顧客候補</h2>
        <span className="text-muted-foreground text-xs">
          この求人と希望条件が合う顧客をスコア化(満点 100)
        </span>
      </div>

      {matches.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          該当する顧客がいません。求人条件 / 顧客の希望条件 をご確認ください。
        </p>
      ) : (
        <ul className="divide-foreground/10 divide-y">
          {matches.map((m) => (
            <li key={m.client.id} className="py-3">
              <Link
                href={`/agency/clients/${m.client.id}`}
                className="hover:bg-accent flex flex-wrap items-start justify-between gap-3 rounded px-1 py-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{m.client.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {clientStatusLabels[m.client.status]}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      担当:{m.client.assigneeName ?? "未割当"}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {m.client.prefecture && <span>勤務地:{m.client.prefecture}</span>}
                    {m.client.desiredAnnualIncome !== null && (
                      <span>希望年収 {m.client.desiredAnnualIncome} 万円</span>
                    )}
                    {m.client.currentEmploymentType && (
                      <span>現雇用 {m.client.currentEmploymentType}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.reasons.map((r) => (
                      <span
                        key={r}
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${REASON_TONE[r]}`}
                      >
                        {REASON_LABEL[r]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums">{m.score}</div>
                  <div className="text-muted-foreground text-[10px]">/100</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
