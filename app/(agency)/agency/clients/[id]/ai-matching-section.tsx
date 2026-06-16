"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError, apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type { JobPosting } from "@/lib/jobs/types";

import {
  QuotaExceededModal,
  extractQuotaInfo,
  type QuotaInfo,
} from "@/app/(app)/_components/quota-exceeded-modal";

type AiItem = {
  job_posting_id: string;
  score: number;
  rationale: string;
};

type AiResponse = {
  items: AiItem[];
  generatedAt: string | null;
  cached: boolean;
  note?: string;
  interestedJobIds?: string[];
  /** job_posting_id → referrals.status のマップ(紹介中表示用) */
  referralByJobId?: Record<string, string>;
  usage?: {
    current: number;
    limit: number;
    addon: boolean;
    resetsAt: string;
  };
};

type Props = {
  clientRecordId: string;
  /** UI で詳細を引くために必要(別 RPC では引けないため SSR から渡す) */
  openJobs: ReadonlyArray<JobPosting>;
};

/**
 * AI 求人推薦セクション。
 *
 * - 初回マウント時にキャッシュ取得(ない場合は AI 推論を待つ)
 * - 「再計算」ボタンで強制再計算
 * - 結果は cached / generatedAt と一緒に表示
 */
export function AiMatchingSection({ clientRecordId, openJobs }: Props) {
  const [data, setData] = useState<AiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);
  /** + 紹介する 進行中の job_id(楽観 disable のため) */
  const [referring, setReferring] = useState<Set<string>>(new Set());
  /** 楽観的に「紹介済」にした job_id(API 成功後にローカル反映) */
  const [recentlyReferred, setRecentlyReferred] = useState<Record<string, string>>({});

  // 「+ 紹介する」:既存 POST /api/agency/referrals を叩く(status='planned' で作成)
  const handleAddReferral = async (jobPostingId: string) => {
    setReferring((prev) => new Set(prev).add(jobPostingId));
    setError(null);
    try {
      await apiFetch(`/api/agency/referrals`, {
        method: "POST",
        json: {
          client_record_id: clientRecordId,
          job_posting_id: jobPostingId,
        },
      });
      setRecentlyReferred((prev) => ({ ...prev, [jobPostingId]: "planned" }));
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        // 既に紹介済(別タブで作成済等)→ローカル反映だけ
        setRecentlyReferred((prev) => ({ ...prev, [jobPostingId]: "planned" }));
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setReferring((prev) => {
        const next = new Set(prev);
        next.delete(jobPostingId);
        return next;
      });
    }
  };

  const fetchMatches = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<AiResponse>(
          `/api/agency/clients/${clientRecordId}/job-matches${force ? "?force=1" : ""}`,
        );
        if (res) setData(res);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 402) {
          setQuotaInfo(extractQuotaInfo(err.body));
        } else {
          setError(getErrorMessage(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [clientRecordId],
  );

  // マウント時にキャッシュ取得を 1 度だけ走らせる(set-state-in-effect 警告回避のため ref ガード)
  const didFetchRef = useRef(false);
  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    void fetchMatches(false);
  }, [fetchMatches]);

  const jobById = new Map<string, JobPosting>();
  for (const j of openJobs) jobById.set(j.id, j);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">AI 求人推薦(キャリア棚卸し + 診断ベース)</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            棚卸し・診断結果から、自社求人のなかでマッチ度が高いものを Claude が並べます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.usage && (
            <span className="text-muted-foreground text-[11px]">
              今月: {data.usage.current} / {data.usage.limit}
              {data.usage.addon && (
                <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  アドオン
                </span>
              )}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void fetchMatches(true)}
            disabled={loading}
          >
            {loading ? "推論中…" : "再計算"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {data.note ?? "AI 推薦の候補が見つかりませんでした。"}
        </p>
      )}

      {data && data.items.length > 0 && (
        <>
          {/* 紹介中件数のサマリ(本人がすでに見られている状態の可視化) */}
          {(() => {
            const refMap = { ...(data.referralByJobId ?? {}), ...recentlyReferred };
            const refCount = Object.keys(refMap).length;
            return refCount > 0 ? (
              <p className="text-muted-foreground rounded-md bg-emerald-50/50 px-2 py-1 text-[11px] dark:bg-emerald-950/30">
                📋 この求職者には現在 <strong>{refCount} 件</strong> 紹介しています
              </p>
            ) : null;
          })()}
          <ul className="divide-foreground/10 divide-y">
            {data.items.map((it) => {
              const job = jobById.get(it.job_posting_id);
              if (!job) return null;
              const interested = data.interestedJobIds?.includes(it.job_posting_id);
              const refStatus =
                recentlyReferred[it.job_posting_id] ?? data.referralByJobId?.[it.job_posting_id];
              const isReferring = referring.has(it.job_posting_id);
              return (
                <li key={it.job_posting_id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/agency/jobs/${job.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {job.companyName} ・ {job.position}
                      </Link>
                      {interested && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          🙋 本人が興味あり
                        </span>
                      )}
                      {refStatus && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          📋 紹介中({refStatus})
                        </span>
                      )}
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {it.score} 点
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">{it.rationale}</p>
                  {(job.location || job.salaryMin || job.salaryMax) && (
                    <p className="text-muted-foreground text-[11px]">
                      {[
                        job.location,
                        job.salaryMin || job.salaryMax
                          ? `${job.salaryMin ?? "?"}〜${job.salaryMax ?? "?"}万円`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  )}
                  <div className="flex justify-end pt-1">
                    {refStatus ? (
                      <Button size="sm" variant="ghost" disabled>
                        ✓ 紹介済み
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void handleAddReferral(it.job_posting_id)}
                        disabled={isReferring}
                      >
                        {isReferring ? "紹介中…" : "+ この求人を紹介する"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {data && (
        <p className="text-muted-foreground text-[11px]">
          {data.cached ? "キャッシュ表示" : "新規生成"}
          {data.generatedAt && ` ・ ${new Date(data.generatedAt).toLocaleString("ja-JP")}`}
        </p>
      )}

      <QuotaExceededModal
        open={quotaInfo !== null}
        featureLabel="AI 求人推薦(エージェント)"
        usage={quotaInfo}
        onClose={() => setQuotaInfo(null)}
      />
    </Card>
  );
}
