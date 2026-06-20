"use client";

import { MessageCircle, Send, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);

  const lineReadyReferrals = useMemo(
    () => referrals.filter((r) => r.lineUserId !== null),
    [referrals],
  );
  const allLineSelected =
    lineReadyReferrals.length > 0 &&
    lineReadyReferrals.every((r) => selectedIds.has(r.lineUserId!));

  const toggleSelect = (lineUserId: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(lineUserId)) next.delete(lineUserId);
      else next.add(lineUserId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allLineSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(lineReadyReferrals.map((r) => r.lineUserId!)));
    }
  };

  const onBulkSend = async () => {
    const recipients = Array.from(selectedIds);
    if (recipients.length === 0) return;
    if (
      !window.confirm(
        `${recipients.length} 名 に LINE で この 求人 を 一斉送信 します。 課金通数 ≒ ${recipients.length} 通。 よろしい ですか?`,
      )
    )
      return;
    setBulkSending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/agency/line/share-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserIds: recipients, jobIds: [job.id] }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; requested: number; sent: number; failed: number }
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
      setInfo(
        `一斉送信 完了: 成功 ${body.sent} 名 / 失敗 ${body.failed} 名 (依頼 ${body.requested} 名)`,
      );
      setSelectedIds(new Set());
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBulkSending(false);
    }
  };

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

      {lineReadyReferrals.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-2.5">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={allLineSelected}
              onChange={toggleSelectAll}
              aria-label="LINE 連携済 を 全選択"
            />
            <span>LINE 連携済 を 全選択 ({lineReadyReferrals.length} 名)</span>
          </label>
          <span className="text-muted-foreground text-[10px]">選択中 {selectedIds.size} 名</span>
          <div className="ml-auto">
            <Button
              size="sm"
              onClick={onBulkSend}
              disabled={selectedIds.size === 0 || bulkSending}
              className="bg-[#06C755] text-white hover:bg-[#05a647]"
            >
              <Send className="mr-1 size-3.5" aria-hidden />
              {bulkSending ? "送信中..." : `選択した ${selectedIds.size || 0} 名 に 一斉送信`}
            </Button>
          </div>
        </div>
      )}

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
                  {r.lineUserId && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.lineUserId)}
                      onChange={() => toggleSelect(r.lineUserId!)}
                      aria-label={`${r.clientName} を 選択`}
                      className="mt-1.5"
                    />
                  )}
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
