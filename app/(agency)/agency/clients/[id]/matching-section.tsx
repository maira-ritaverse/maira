"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { ClientRecordWithDecrypted } from "@/lib/clients/types";
import type { JobPosting } from "@/lib/jobs/types";
import { rankMatches, type MatchReason } from "@/lib/matching/score";

type MatchingSectionProps = {
  client: ClientRecordWithDecrypted;
  /** open ステータスの求人(detail page で既にフィルタ済み) */
  openJobs: JobPosting[];
  /** 既に応募済みの job_posting_id 集合(referrals から作成) */
  alreadyAppliedJobIds: ReadonlyArray<string>;
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
 * 求人マッチングセクション(クライアント詳細)
 *
 * 顧客の希望条件(desired_*)と open 求人をスコア化し、トップ 5 を表示。
 * 既に応募済みの求人は除外する(再アプローチは応募管理側で個別判断)。
 *
 * 入力データが不足している場合(例:desired_locations が空)は該当観点で
 * 加点が無いだけで、スコア計算自体は走る。0 点求人は表示しない。
 */
export function MatchingSection({ client, openJobs, alreadyAppliedJobIds }: MatchingSectionProps) {
  const matches = useMemo(() => {
    return rankMatches(
      {
        desiredLocations: client.desiredLocations,
        desiredOccupations: client.desiredOccupations,
        desiredAnnualIncome: client.desiredAnnualIncome,
        currentEmploymentType: client.currentEmploymentType,
      },
      openJobs.map((j) => ({
        id: j.id,
        companyName: j.companyName,
        position: j.position,
        location: j.location,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        employmentType: j.employmentType,
      })),
      { topN: 5, excludeJobIds: new Set(alreadyAppliedJobIds), minScore: 15 },
    );
  }, [client, openJobs, alreadyAppliedJobIds]);

  // 求人 ID → JobPosting Map(描画用に詳細を引く)
  const jobById = useMemo(() => {
    const m = new Map<string, JobPosting>();
    for (const j of openJobs) m.set(j.id, j);
    return m;
  }, [openJobs]);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">求人マッチング候補</h2>
        <span className="text-muted-foreground text-xs">
          希望条件と open 求人をスコア化(満点 100)
        </span>
      </div>

      {matches.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          現時点でマッチする求人がありません。
          <br />
          顧客の希望条件(勤務地・年収・職種)や求人情報の入力状況をご確認ください。
        </p>
      ) : (
        <ul className="divide-foreground/10 divide-y">
          {matches.map((m) => {
            const job = jobById.get(m.jobId);
            if (!job) return null;
            return (
              <li key={m.jobId} className="py-3">
                <Link
                  href={`/agency/jobs/${job.id}`}
                  className="hover:bg-accent flex flex-wrap items-start justify-between gap-3 rounded px-1 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{job.companyName}</span>
                      <span className="text-muted-foreground text-xs">{job.position}</span>
                    </div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                      {job.location && <span>📍 {job.location}</span>}
                      {(job.salaryMin !== null || job.salaryMax !== null) && (
                        <span>
                          💰{" "}
                          {job.salaryMin !== null && job.salaryMax !== null
                            ? `${job.salaryMin}-${job.salaryMax}万円`
                            : job.salaryMin !== null
                              ? `${job.salaryMin}万円以上`
                              : `${job.salaryMax}万円以下`}
                        </span>
                      )}
                      {job.employmentType && <span>{job.employmentType}</span>}
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
            );
          })}
        </ul>
      )}
    </Card>
  );
}
