"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobPosting } from "@/lib/jobs/types";
import {
  type ReferralStatus,
  type ReferralWithJob,
  getReferralStatusConfig,
  referralStatusConfig,
} from "@/lib/referrals/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/**
 * クライアント詳細画面の「紹介状況」セクション
 *
 * 役割:
 *   - このクライアントの紹介一覧を表示(求人企業名・職種・ステータス)
 *   - ステータスを selectで変更 → PATCH /api/agency/referrals/[id]
 *   - 「+ 求人に紹介する」フォーム:open状態の求人から選び POST で作成
 *
 * 求人一覧と紹介一覧は server 側(page.tsx)で取得して props で渡す。
 * 変更後は router.refresh() で再取得する(楽観更新はしない)。
 */

type Props = {
  clientId: string;
  referrals: ReferralWithJob[];
  openJobs: JobPosting[];
};

export function ReferralSection({ clientId, referrals, openJobs }: Props) {
  const router = useRouter();

  return (
    <Card className="space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">紹介状況</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          このクライアントを求人に紹介し、選考の進捗を管理します
        </p>
      </div>

      <ReferralCreateForm
        clientId={clientId}
        openJobs={openJobs}
        existingJobIds={new Set(referrals.map((r) => r.jobPostingId))}
        onCreated={() => router.refresh()}
      />

      <ReferralList referrals={referrals} onUpdated={() => router.refresh()} />
    </Card>
  );
}

// ============================================
// 紹介一覧 + ステータス変更
// ============================================

function ReferralList({
  referrals,
  onUpdated,
}: {
  referrals: ReferralWithJob[];
  onUpdated: () => void;
}) {
  if (referrals.length === 0) {
    return (
      <div className="border-muted-foreground/20 text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
        まだ紹介がありません。上のフォームから求人を選んで紹介してください。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">紹介中の求人({referrals.length}件)</h3>
      <ul className="space-y-2">
        {referrals.map((r) => (
          <ReferralRow key={r.id} referral={r} onUpdated={onUpdated} />
        ))}
      </ul>
    </div>
  );
}

function ReferralRow({
  referral,
  onUpdated,
}: {
  referral: ReferralWithJob;
  onUpdated: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const config = getReferralStatusConfig(referral.status);

  const handleStatusChange = (next: ReferralStatus) => {
    if (next === referral.status) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/agency/referrals/${referral.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "更新に失敗しました");
        }
        onUpdated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <li className="border-border rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{referral.jobCompanyName}</p>
          <p className="text-muted-foreground truncate text-xs">{referral.jobPosition}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${config.className}`}>
            {config.label}
          </span>
          <select
            aria-label="ステータスを変更"
            value={referral.status}
            disabled={isPending}
            onChange={(e) => handleStatusChange(e.target.value as ReferralStatus)}
            className="border-input bg-background rounded-md border px-2 py-1 text-xs"
          >
            {referralStatusConfig.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {referral.notes && (
        <p className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">{referral.notes}</p>
      )}
      {error && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}
    </li>
  );
}

// ============================================
// 新規紹介フォーム(求人を選んで notes を添えて作成)
// ============================================

function ReferralCreateForm({
  clientId,
  openJobs,
  existingJobIds,
  onCreated,
}: {
  clientId: string;
  openJobs: JobPosting[];
  existingJobIds: Set<string>;
  onCreated: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [jobId, setJobId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 既に紹介済みの求人は選択肢から除外する(二重紹介の事前防止 + UX)
  const selectableJobs = openJobs.filter((j) => !existingJobIds.has(j.id));

  const reset = () => {
    setJobId("");
    setNotes("");
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId) {
      setError("求人を選んでください");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/agency/referrals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_record_id: clientId,
            job_posting_id: jobId,
            notes,
          }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "紹介の作成に失敗しました");
        }
        reset();
        setIsOpen(false);
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  if (!isOpen) {
    return (
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          disabled={openJobs.length === 0}
        >
          + 求人に紹介する
        </Button>
        {openJobs.length === 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            紹介できる求人がありません(募集中の求人を登録してください)。
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-border space-y-3 rounded-md border p-4">
      <div className="space-y-2">
        <Label htmlFor="referral-job">
          紹介する求人 <span className="text-red-600">*</span>
        </Label>
        <select
          id="referral-job"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          disabled={isPending || selectableJobs.length === 0}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        >
          <option value="">求人を選択...</option>
          {selectableJobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.companyName} / {j.position}
            </option>
          ))}
        </select>
        {selectableJobs.length === 0 && (
          <p className="text-muted-foreground text-xs">
            このクライアントは募集中の求人すべてに紹介済みです。
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="referral-notes">推薦メモ</Label>
        <textarea
          id="referral-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          rows={4}
          maxLength={2000}
          placeholder="なぜこの方をこの求人に推薦するか(任意)"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending || selectableJobs.length === 0}>
          {isPending ? "作成中..." : "紹介を作成"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            reset();
            setIsOpen(false);
          }}
        >
          キャンセル
        </Button>
      </div>
    </form>
  );
}
