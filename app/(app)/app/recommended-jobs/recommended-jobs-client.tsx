"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError, apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type { JobPosting } from "@/lib/jobs/types";

import {
  QuotaExceededModal,
  extractQuotaInfo,
  type QuotaInfo,
} from "../../_components/quota-exceeded-modal";

type Item = {
  job: JobPosting & { organizationName: string };
  score: number;
  rationale: string;
};

type Response = {
  items: Item[];
  totalOpenJobs: number;
  generatedAt: string;
  cached: boolean;
  interestedJobIds: string[];
  requestedJobIds: string[];
  usage?: {
    current: number;
    limit: number;
    addon: boolean;
    resetsAt: string;
  };
};

/**
 * 求職者向け AI 求人推薦の表示クライアントコンポーネント。
 *
 * - マウント時に 1 回だけ API を叩く(キャッシュ命中時は即返り)
 * - 「再計算」で force=1 を付けて強制リフェッチ
 * - 各カードに「興味あり」トグルボタン
 */
export function RecommendedJobsClient() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interestedSet, setInterestedSet] = useState<Set<string>>(new Set());
  const [interestPending, setInterestPending] = useState<Set<string>>(new Set());
  const [requestedSet, setRequestedSet] = useState<Set<string>>(new Set());
  const [applyPending, setApplyPending] = useState<Set<string>>(new Set());
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);

  const fetchData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<Response>(`/api/me/job-recommendations${force ? "?force=1" : ""}`);
      if (res) {
        setData(res);
        setInterestedSet(new Set(res.interestedJobIds));
        setRequestedSet(new Set(res.requestedJobIds));
      }
    } catch (err) {
      // 402(クォータ超過)はモーダルで誘導、それ以外はインラインエラー
      if (err instanceof ApiClientError && err.status === 402) {
        const info = extractQuotaInfo(err.body);
        setQuotaInfo(info);
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const didFetchRef = useRef(false);
  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    void fetchData(false);
  }, [fetchData]);

  const requestApply = async (jobId: string) => {
    if (!confirm("この求人への応募をエージェントに依頼しますか?")) return;
    setApplyPending((prev) => new Set(prev).add(jobId));
    setError(null);
    try {
      await apiFetch(`/api/me/job-recommendations/${jobId}/apply`, { method: "POST" });
      setRequestedSet((prev) => new Set(prev).add(jobId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplyPending((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const toggleInterest = async (jobId: string) => {
    const wasInterested = interestedSet.has(jobId);
    // 楽観的更新
    setInterestedSet((prev) => {
      const next = new Set(prev);
      if (wasInterested) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
    setInterestPending((prev) => new Set(prev).add(jobId));
    try {
      await apiFetch(`/api/me/job-recommendations/${jobId}/interest`, {
        method: wasInterested ? "DELETE" : "POST",
      });
    } catch (err) {
      // ロールバック
      setInterestedSet((prev) => {
        const next = new Set(prev);
        if (wasInterested) next.add(jobId);
        else next.delete(jobId);
        return next;
      });
      setError(getErrorMessage(err));
    } finally {
      setInterestPending((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {data?.usage && (
          <span className="text-muted-foreground text-[11px]">
            今月の AI 推薦: {data.usage.current} / {data.usage.limit} 回
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
          onClick={() => {
            if (data?.usage && data.usage.current >= data.usage.limit - 2 && !data.usage.addon) {
              if (
                !confirm(
                  `今月の残り回数が少なくなっています(${data.usage.current} / ${data.usage.limit})。再計算しますか?`,
                )
              )
                return;
            }
            void fetchData(true);
          }}
          disabled={loading}
        >
          {loading ? "推論中…" : "再計算"}
        </Button>
      </div>

      {loading && !data && (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          AI で求人を分析しています…(10〜20 秒、初回のみ)
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50/60 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </Card>
      )}

      {data && data.totalOpenJobs === 0 && (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          現在、連携エージェンシーで公開中の求人はありません。
          <br />
          エージェンシーが新しい求人を追加するとここに表示されます。
        </Card>
      )}

      {data && data.totalOpenJobs > 0 && data.items.length === 0 && (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          現時点でマッチする求人が見つかりませんでした。
          <br />
          キャリア棚卸しを進めたり、希望条件を更新すると推薦精度が向上します。
        </Card>
      )}

      {data && data.items.length > 0 && (
        <ul className="space-y-3">
          {data.items.map((it) => {
            const interested = interestedSet.has(it.job.id);
            const pending = interestPending.has(it.job.id);
            return (
              <Card key={it.job.id} className="space-y-2 p-4">
                <Link href={`/app/jobs/${it.job.id}`} className="block space-y-2 hover:opacity-80">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {it.job.companyName} ・ {it.job.position}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        {it.job.organizationName} 経由
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {it.score} 点
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">{it.rationale}</p>
                  <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {it.job.location && <span>勤務地:{it.job.location}</span>}
                    {(it.job.salaryMin || it.job.salaryMax) && (
                      <span>
                        年収:{it.job.salaryMin ?? "?"}〜{it.job.salaryMax ?? "?"} 万円
                      </span>
                    )}
                    {it.job.employmentType && <span>雇用形態:{it.job.employmentType}</span>}
                  </div>
                  {it.job.description && (
                    <p className="text-muted-foreground line-clamp-3 text-xs whitespace-pre-wrap">
                      {it.job.description}
                    </p>
                  )}
                  <p className="text-foreground text-[11px] font-medium underline-offset-2 hover:underline">
                    詳細を見る →
                  </p>
                </Link>
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant={interested ? "outline" : "ghost"}
                    onClick={() => void toggleInterest(it.job.id)}
                    disabled={pending}
                  >
                    {pending ? "更新中…" : interested ? "興味あり(取り消す)" : "興味あり"}
                  </Button>
                  {requestedSet.has(it.job.id) ? (
                    <>
                      <Button size="sm" variant="outline" disabled>
                        依頼済み
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          window.location.href = "/app/agent-referrals";
                        }}
                      >
                        進捗を見る →
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void requestApply(it.job.id)}
                      disabled={applyPending.has(it.job.id)}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" />
                      {applyPending.has(it.job.id) ? "依頼中…" : "応募を依頼"}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      {data && (
        <p className="text-muted-foreground text-right text-[10px]">
          {data.totalOpenJobs} 件の求人から分析
          {data.cached ? "(キャッシュ表示)" : "(新規生成)"} ・{" "}
          {new Date(data.generatedAt).toLocaleString("ja-JP")}
        </p>
      )}

      <QuotaExceededModal
        open={quotaInfo !== null}
        featureLabel="AI 求人推薦"
        usage={quotaInfo}
        onClose={() => setQuotaInfo(null)}
      />
    </div>
  );
}
