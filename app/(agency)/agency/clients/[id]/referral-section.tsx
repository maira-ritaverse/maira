"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobPosting } from "@/lib/jobs/types";
import {
  type ReferralStatus,
  type ReferralStatusHistoryWithAuthor,
  type ReferralWithJob,
  getReferralStatusConfig,
  referralStatusConfig,
} from "@/lib/referrals/types";
import {
  type PaymentStatus,
  type PlacementEventType,
  type PlacementWithAuthor,
  getPaymentStatusConfig,
  getPlacementEventTypeConfig,
  paymentStatusConfig,
} from "@/lib/placements/types";
import { type PlacementAggregate, aggregatePlacements } from "@/lib/placements/aggregate";
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
  placements: PlacementWithAuthor[];
  // referral_id でグルーピングされた status 遷移履歴。
  // page.tsx で listReferralStatusHistoriesByReferralIds から受け取る。
  // 各値は changed_at 昇順(古い→新しい)。
  historiesByReferral: Map<string, ReferralStatusHistoryWithAuthor[]>;
  isAdmin: boolean;
};

export function ReferralSection({
  clientId,
  referrals,
  openJobs,
  placements,
  historiesByReferral,
  isAdmin,
}: Props) {
  const router = useRouter();

  // referralId ごとに placements を分けておく(各 row の表示用)
  // 件数が増えても線形で済むので useMemo で十分
  const placementsByReferral = useMemo(() => {
    const map = new Map<string, PlacementWithAuthor[]>();
    for (const p of placements) {
      const arr = map.get(p.referralId);
      if (arr) arr.push(p);
      else map.set(p.referralId, [p]);
    }
    return map;
  }, [placements]);

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

      <ReferralList
        referrals={referrals}
        placementsByReferral={placementsByReferral}
        historiesByReferral={historiesByReferral}
        isAdmin={isAdmin}
        onUpdated={() => router.refresh()}
      />
    </Card>
  );
}

// ============================================
// 紹介一覧 + ステータス変更
// ============================================

function ReferralList({
  referrals,
  placementsByReferral,
  historiesByReferral,
  isAdmin,
  onUpdated,
}: {
  referrals: ReferralWithJob[];
  placementsByReferral: Map<string, PlacementWithAuthor[]>;
  historiesByReferral: Map<string, ReferralStatusHistoryWithAuthor[]>;
  isAdmin: boolean;
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
          <ReferralRow
            key={r.id}
            referral={r}
            placements={placementsByReferral.get(r.id) ?? []}
            histories={historiesByReferral.get(r.id) ?? []}
            isAdmin={isAdmin}
            onUpdated={onUpdated}
          />
        ))}
      </ul>
    </div>
  );
}

function ReferralRow({
  referral,
  placements,
  histories,
  isAdmin,
  onUpdated,
}: {
  referral: ReferralWithJob;
  placements: PlacementWithAuthor[];
  histories: ReferralStatusHistoryWithAuthor[];
  isAdmin: boolean;
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

      <StatusHistoryBlock histories={histories} />

      <PlacementBlock
        referralId={referral.id}
        placements={placements}
        isAdmin={isAdmin}
        onChanged={onUpdated}
      />
    </li>
  );
}

// ============================================
// 選考の足跡(status 遷移履歴)
//
// referrals.status が変わった瞬間を referral_status_history に自動記録している
// (PATCH /api/agency/referrals/[id] 側で実装)。それを時系列で表示する。
//
// 表示方針:
//   - 古い → 新しい の順(タイムラインは上から下に進む読み方)
//   - 各行は from バッジ → to バッジ + 日時 + 変更者
//   - 初回履歴(from が null)は「to」だけバッジ表示
//   - 履歴が無いときも空状態メッセージで「まだ変更履歴がありません」を出す
//     (status が一度も変わっていない紹介である説明として残す)
//   - スタイルは PlacementBlock とお揃いで、referral 内のサブブロック扱い
// ============================================
function StatusHistoryBlock({ histories }: { histories: ReferralStatusHistoryWithAuthor[] }) {
  return (
    <div className="border-border/60 mt-3 space-y-2 border-t pt-3">
      <h4 className="text-muted-foreground text-xs font-medium">選考の足跡</h4>
      {histories.length === 0 ? (
        <p className="text-muted-foreground text-xs">まだ変更履歴がありません。</p>
      ) : (
        <ol className="space-y-1.5">
          {histories.map((h) => (
            <StatusHistoryRow key={h.id} history={h} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StatusHistoryRow({ history }: { history: ReferralStatusHistoryWithAuthor }) {
  // from が null = 初回履歴(現状の実装では作成時の自動記録は無いので、
  // 手動 insert や将来仕様の余地として残してある)。to だけ表示する。
  const fromConfig = history.fromStatus ? getReferralStatusConfig(history.fromStatus) : null;
  const toConfig = getReferralStatusConfig(history.toStatus);

  return (
    <li className="border-border bg-background rounded-md border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {fromConfig && (
          <>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${fromConfig.className}`}>
              {fromConfig.label}
            </span>
            <span className="text-muted-foreground">→</span>
          </>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${toConfig.className}`}>
          {toConfig.label}
        </span>
        <time className="text-muted-foreground" dateTime={history.changedAt}>
          {formatChangedAt(history.changedAt)}
        </time>
      </div>
      {history.changedByName && (
        <p className="text-muted-foreground mt-1 text-[10px]">変更者: {history.changedByName}</p>
      )}
      {history.memo && <p className="text-foreground mt-1 whitespace-pre-wrap">{history.memo}</p>}
    </li>
  );
}

// 履歴行の日時表示。
// 既存の interactions の formatOccurredAt と揃え、年/月/日 時:分。
// (interactions と違って「今日なら時刻だけ」は採用しない:
//  履歴は過去を眺める用途なので、いつでも日付を出すほうが読みやすい。)
function formatChangedAt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================
// 成約(placements)ブロック
//
// この referral に紐づく全イベント(placement/payment/refund/additional)を
// 時系列で表示し、各種イベントを追加する。
//
// 表示・登録のルール:
//   - placement(成約)は最初に登録する。なければ他イベントは追加できない
//   - payment(入金)は admin のみ登録できる(API でも強制)
//   - refund / additional は同 org の誰でも登録できる
// 純売上の集計は次のステップで実装する。
// ============================================

// 同時に開けるフォームは1つに絞る(UI を素直にするため)。
type EventFormKind = "placement" | "payment" | "refund" | "additional";

// 各イベント種別ごとの日付ラベル
function eventDateLabel(eventType: PlacementEventType): string {
  switch (eventType) {
    case "placement":
      return "入社日";
    case "payment":
      return "入金日";
    case "refund":
      return "返金日";
    case "additional":
      return "発生日";
  }
}

function PlacementBlock({
  referralId,
  placements,
  isAdmin,
  onChanged,
}: {
  referralId: string;
  placements: PlacementWithAuthor[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [openForm, setOpenForm] = useState<EventFormKind | null>(null);

  // 成約(placement)があるかどうか。なければ追加イベント類は登録不可。
  const hasPlacement = placements.some((p) => p.eventType === "placement");

  // 集計(純売上・入金済み・残額)
  // 件数は通常少ないが、placements が変わらない限り再計算しないように memo 化
  const summary = useMemo(() => aggregatePlacements(placements), [placements]);

  const close = () => setOpenForm(null);
  const handleCreated = () => {
    close();
    onChanged();
  };

  return (
    <div className="border-border/60 mt-3 space-y-2 border-t pt-3">
      <h4 className="text-muted-foreground text-xs font-medium">成約</h4>

      {summary.hasEvents && <PlacementSummary summary={summary} />}

      {placements.length > 0 ? (
        <ul className="space-y-1.5">
          {placements.map((p) => (
            <PlacementEventRow key={p.id} placement={p} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">まだ成約は登録されていません。</p>
      )}

      {openForm === null && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpenForm("placement")}
          >
            + 成約を登録
          </Button>
          {hasPlacement && (
            <>
              {/* 入金確定は admin 限定。非 admin にはボタン自体を出さない。 */}
              {isAdmin && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpenForm("payment")}
                >
                  + 入金を記録
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpenForm("refund")}
              >
                + 返金を記録
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpenForm("additional")}
              >
                + 追加報酬を記録
              </Button>
            </>
          )}
        </div>
      )}

      {openForm === "placement" && (
        <PlacementCreateForm referralId={referralId} onCreated={handleCreated} onCancel={close} />
      )}
      {(openForm === "payment" || openForm === "refund" || openForm === "additional") && (
        <EventCreateForm
          referralId={referralId}
          eventType={openForm}
          onCreated={handleCreated}
          onCancel={close}
        />
      )}
    </div>
  );
}

// ============================================
// 成約サマリ表示(純売上 / 入金済み / 残額 + 内訳)
//
// ⚠️ 金額はすべて整数(円)。toLocaleString で 1500000 → "1,500,000"。
// 「残額」は符号で意味が変わるので、ラベルと色で示し分ける。
// ============================================
function PlacementSummary({ summary }: { summary: PlacementAggregate }) {
  // 残額の表示:
  //   > 0  → 未入金(注意色、まだ入金待ち)
  //   = 0  → 完済(完了色)
  //   < 0  → 過入金(中立情報色、想定より入っている)
  const remainderConfig =
    summary.unpaid > 0
      ? {
          label: "未入金",
          className: "text-amber-700 dark:text-amber-300",
        }
      : summary.unpaid < 0
        ? {
            label: "過入金",
            className: "text-sky-700 dark:text-sky-300",
          }
        : {
            label: "完済",
            className: "text-emerald-700 dark:text-emerald-300",
          };

  return (
    <div className="border-border bg-muted/40 space-y-1.5 rounded-md border p-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <span className="text-muted-foreground">純売上</span>
          <span className="ml-1.5 text-base font-semibold">
            ¥{summary.netRevenue.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">入金済み</span>
          <span className="ml-1.5 font-medium">¥{summary.paid.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{remainderConfig.label}</span>
          <span className={`ml-1.5 font-medium ${remainderConfig.className}`}>
            ¥{Math.abs(summary.unpaid).toLocaleString()}
          </span>
        </div>
      </div>
      <p className="text-muted-foreground text-[10px]">
        内訳: 成約 ¥{summary.placementTotal.toLocaleString()} + 追加 ¥
        {summary.additionalTotal.toLocaleString()} − 返金 ¥{summary.refundTotal.toLocaleString()}
      </p>
    </div>
  );
}

// 1イベントの表示(全 event_type に対応)
function PlacementEventRow({ placement }: { placement: PlacementWithAuthor }) {
  const config = getPlacementEventTypeConfig(placement.eventType);
  const amountLabel =
    placement.amount !== null ? `¥${placement.amount.toLocaleString()}` : "(金額未設定)";

  // placement の計算根拠(年収×率)があれば添える
  const hasCalc =
    placement.eventType === "placement" &&
    placement.expectedSalary !== null &&
    placement.commissionRate !== null;
  const calcLabel = hasCalc
    ? `(年収${placement.expectedSalary}万円 × ${placement.commissionRate}%)`
    : null;

  // payment_status バッジ(payment イベントで主に使う)
  const statusConfig = placement.paymentStatus
    ? getPaymentStatusConfig(placement.paymentStatus)
    : null;

  return (
    <li className="border-border bg-background rounded-md border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${config.className}`}>
          {config.label}
        </span>
        <span className="text-muted-foreground">
          {eventDateLabel(placement.eventType)} {placement.eventDate}
        </span>
        <span className="font-medium">{amountLabel}</span>
        {calcLabel && <span className="text-muted-foreground">{calcLabel}</span>}
        {statusConfig && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusConfig.className}`}>
            {statusConfig.label}
          </span>
        )}
      </div>
      {/* refund/additional は理由を強調表示 */}
      {placement.reason && (
        <p className="text-foreground mt-1 whitespace-pre-wrap">
          <span className="text-muted-foreground">理由: </span>
          {placement.reason}
        </p>
      )}
      {placement.notes && (
        <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{placement.notes}</p>
      )}
      {placement.authorName && (
        <p className="text-muted-foreground mt-1 text-[10px]">記録: {placement.authorName}</p>
      )}
    </li>
  );
}

// ============================================
// 入金 / 返金 / 追加報酬 の登録フォーム
//
// 3種類で UI 形が似ているので 1コンポーネントにまとめ、event_type で分岐。
// - payment   : 入金額 + 入金日 + payment_status(任意の補足:メモ)
// - refund    : 返金額 + 返金日 + 理由
// - additional: 追加額 + 発生日 + 理由
// ============================================
function EventCreateForm({
  referralId,
  eventType,
  onCreated,
  onCancel,
}: {
  referralId: string;
  eventType: "payment" | "refund" | "additional";
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [eventDate, setEventDate] = useState<string>(todayLocalDate());
  const [amount, setAmount] = useState<string>("");
  // payment_status のデフォルトは「入金済」=paid。
  // 部分入金 partial や、後から確定したい場合は手動切替。
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // タイトル・ラベル・amount placeholder を event_type で出し分け
  const titleByType: Record<typeof eventType, string> = {
    payment: "入金を記録",
    refund: "返金を記録",
    additional: "追加報酬を記録",
  };
  const amountLabelByType: Record<typeof eventType, string> = {
    payment: "入金額(円)",
    refund: "返金額(円)",
    additional: "追加額(円)",
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!eventDate) {
      setError(`${eventDateLabel(eventType)}を入力してください`);
      return;
    }
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) {
      setError(`${amountLabelByType[eventType]}を入力してください`);
      return;
    }
    if ((eventType === "refund" || eventType === "additional") && !reason.trim()) {
      setError("理由を入力してください");
      return;
    }

    const payload: Record<string, unknown> = {
      referral_id: referralId,
      event_type: eventType,
      event_date: eventDate,
      amount: Math.floor(a),
      notes: notes || undefined,
    };
    if (eventType === "payment") {
      payload.payment_status = paymentStatus;
    } else {
      payload.reason = reason;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/agency/placements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "登録に失敗しました");
        }
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-muted/30 space-y-3 rounded-md border p-3"
    >
      <p className="text-xs font-medium">{titleByType[eventType]}</p>

      {/* 日付 */}
      <div className="space-y-1.5">
        <Label htmlFor={`event-date-${eventType}-${referralId}`} className="text-xs">
          {eventDateLabel(eventType)} <span className="text-red-600">*</span>
        </Label>
        <input
          id={`event-date-${eventType}-${referralId}`}
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          disabled={isPending}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {/* 金額 */}
      <div className="space-y-1.5">
        <Label htmlFor={`event-amount-${eventType}-${referralId}`} className="text-xs">
          {amountLabelByType[eventType]} <span className="text-red-600">*</span>
        </Label>
        <input
          id={`event-amount-${eventType}-${referralId}`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isPending}
          placeholder={eventType === "payment" ? "例: 1500000" : "例: 100000"}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {/* payment のみステータス、それ以外は理由 */}
      {eventType === "payment" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`event-status-${referralId}`} className="text-xs">
            ステータス
          </Label>
          <select
            id={`event-status-${referralId}`}
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {paymentStatusConfig.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`event-reason-${eventType}-${referralId}`} className="text-xs">
            理由 <span className="text-red-600">*</span>
          </Label>
          <textarea
            id={`event-reason-${eventType}-${referralId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            rows={2}
            maxLength={2000}
            placeholder={eventType === "refund" ? "例: 早期離職による全額返金" : "例: 紹介ボーナス"}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      )}

      {/* メモ(任意) */}
      <div className="space-y-1.5">
        <Label htmlFor={`event-notes-${eventType}-${referralId}`} className="text-xs">
          メモ
        </Label>
        <textarea
          id={`event-notes-${eventType}-${referralId}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          rows={2}
          maxLength={2000}
          placeholder="任意"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "登録中..." : "登録"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

// ============================================
// 成約登録フォーム(計算 / 直接入力 の2モード)
// ============================================

type AmountMode = "calc" | "direct";

// YYYY-MM-DD のローカル日付
// (toISOString() だと UTC ずれで前日になりうるので避ける)
function todayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function PlacementCreateForm({
  referralId,
  onCreated,
  onCancel,
}: {
  referralId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<AmountMode>("calc");
  const [eventDate, setEventDate] = useState<string>(todayLocalDate());
  // 計算モード入力
  const [salaryManen, setSalaryManen] = useState<string>(""); // 万円
  const [rate, setRate] = useState<string>(""); // %
  // 直接入力モード
  const [directAmount, setDirectAmount] = useState<string>(""); // 円
  const [notes, setNotes] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 計算結果(円)。年収(万円)× 10000 × 率(%)/100 = 万円 × 率 × 100
  // 例: 500万 × 30% = 500 × 30 × 100 = 1,500,000 円
  const calculatedAmount = useMemo(() => {
    if (mode !== "calc") return null;
    const s = Number(salaryManen);
    const r = Number(rate);
    if (!Number.isFinite(s) || !Number.isFinite(r)) return null;
    if (s <= 0 || r <= 0) return null;
    return Math.round(s * r * 100);
  }, [mode, salaryManen, rate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!eventDate) {
      setError("入社日を入力してください");
      return;
    }

    // モードごとに送信ペイロードを組み立てる
    let payload: Record<string, unknown>;
    if (mode === "calc") {
      const s = Number(salaryManen);
      const r = Number(rate);
      if (!Number.isFinite(s) || s <= 0) {
        setError("想定年収(万円)を入力してください");
        return;
      }
      if (!Number.isFinite(r) || r <= 0) {
        setError("手数料率(%)を入力してください");
        return;
      }
      if (calculatedAmount === null) {
        setError("売上額の計算に失敗しました");
        return;
      }
      payload = {
        referral_id: referralId,
        event_type: "placement",
        event_date: eventDate,
        amount: calculatedAmount,
        expected_salary: Math.floor(s),
        commission_rate: r,
        notes: notes || undefined,
      };
    } else {
      const a = Number(directAmount);
      if (!Number.isFinite(a) || a <= 0) {
        setError("売上額(円)を入力してください");
        return;
      }
      payload = {
        referral_id: referralId,
        event_type: "placement",
        event_date: eventDate,
        amount: Math.floor(a),
        notes: notes || undefined,
      };
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/agency/placements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "成約の登録に失敗しました");
        }
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-muted/30 space-y-3 rounded-md border p-3"
    >
      {/* 入社日 */}
      <div className="space-y-1.5">
        <Label htmlFor={`placement-date-${referralId}`} className="text-xs">
          入社日 <span className="text-red-600">*</span>
        </Label>
        <input
          id={`placement-date-${referralId}`}
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          disabled={isPending}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {/* モード切替 */}
      <div className="space-y-1.5">
        <Label className="text-xs">金額の入力方法</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === "calc" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("calc")}
            disabled={isPending}
          >
            計算する
          </Button>
          <Button
            type="button"
            variant={mode === "direct" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("direct")}
            disabled={isPending}
          >
            直接入力
          </Button>
        </div>
      </div>

      {mode === "calc" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`placement-salary-${referralId}`} className="text-xs">
                想定年収(万円)
              </Label>
              <input
                id={`placement-salary-${referralId}`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={salaryManen}
                onChange={(e) => setSalaryManen(e.target.value)}
                disabled={isPending}
                placeholder="例: 500"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`placement-rate-${referralId}`} className="text-xs">
                手数料率(%)
              </Label>
              <input
                id={`placement-rate-${referralId}`}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.01}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                disabled={isPending}
                placeholder="例: 30"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs">
            <span className="text-muted-foreground">売上額(計算結果):</span>{" "}
            <span className="font-medium">
              {calculatedAmount !== null ? `¥${calculatedAmount.toLocaleString()}` : "—"}
            </span>
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`placement-amount-${referralId}`} className="text-xs">
            売上額(円) <span className="text-red-600">*</span>
          </Label>
          <input
            id={`placement-amount-${referralId}`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={directAmount}
            onChange={(e) => setDirectAmount(e.target.value)}
            disabled={isPending}
            placeholder="例: 1500000"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`placement-notes-${referralId}`} className="text-xs">
          メモ
        </Label>
        <textarea
          id={`placement-notes-${referralId}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          rows={2}
          maxLength={2000}
          placeholder="任意"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "登録中..." : "成約を登録"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
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
