"use client";

import { MessageCircle, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/api/client-fetch";
import type { JobPosting } from "@/lib/jobs/types";
import { getReferralStatusConfig, type ReferralStatus } from "@/lib/referrals/types";

/**
 * 求人 詳細 ページ の 「推薦中 クライアント」 セクション。
 *
 * 機能:
 *   ・referrals テーブル 経由 の 推薦 一覧 を 表示 (ステータス バッジ + 担当)
 *   ・LINE 紐付け 済 なら 「LINE で 共有」 ボタン (= /api/agency/line/share-job)
 *   ・「推薦 解除」 ボタン で referrals DELETE
 */
type ReferralView = {
  referralId: string;
  clientRecordId: string;
  clientName: string;
  assigneeName: string | null;
  status: ReferralStatus;
  notes: string | null;
  lineUserId: string | null;
  createdAt: string;
};

type Props = {
  job: JobPosting;
  referrals: ReferralView[];
};

export function JobRecommendationsSection({ job, referrals }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onShareLine = async (lineUserId: string, clientName: string) => {
    setBusyId(`line:${lineUserId}`);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/agency/line/share-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, jobIds: [job.id] }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; sendMethod: "reply" | "push" }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setInfo(`${clientName} さん に LINE で 求人 を 送信 しました (${body.sendMethod})`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (referralId: string, clientName: string) => {
    if (!window.confirm(`${clientName} さん の 推薦 を 解除 しますか?`)) return;
    setBusyId(`del:${referralId}`);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/agency/referrals/${referralId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">推薦中 のクライアント</h2>
        <span className="text-muted-foreground text-xs">{referrals.length} 名</span>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertDescription className="text-emerald-700">{info}</AlertDescription>
        </Alert>
      )}

      {referrals.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
          <UserPlus className="text-muted-foreground mx-auto size-6" aria-hidden />
          <p className="text-muted-foreground mt-2 text-sm">
            まだ 推薦中 の クライアント は いません
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            下記 「マッチする顧客候補」 から 「推薦に追加」 して ください
          </p>
        </div>
      ) : (
        <ul className="divide-foreground/10 divide-y">
          {referrals.map((r) => {
            const statusCfg = getReferralStatusConfig(r.status);
            return (
              <li key={r.referralId} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Link
                        href={`/agency/clients/${r.clientRecordId}`}
                        className="font-medium hover:underline"
                      >
                        {r.clientName}
                      </Link>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusCfg.className}`}
                      >
                        {statusCfg.label}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        担当:{r.assigneeName ?? "未割当"}
                      </span>
                      {r.lineUserId && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                          LINE 連携済
                        </span>
                      )}
                    </div>
                    {r.notes && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.notes}</p>
                    )}
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      推薦日:{new Date(r.createdAt).toLocaleDateString("ja-JP")}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1">
                    {r.lineUserId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void onShareLine(r.lineUserId!, r.clientName)}
                        disabled={busyId === `line:${r.lineUserId}`}
                        className="text-emerald-700 hover:bg-emerald-50"
                      >
                        <MessageCircle className="mr-1 size-3.5" aria-hidden />
                        {busyId === `line:${r.lineUserId}` ? "送信中..." : "LINE で 共有"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onDelete(r.referralId, r.clientName)}
                      disabled={busyId === `del:${r.referralId}`}
                      aria-label="推薦 解除"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
