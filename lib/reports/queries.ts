/**
 * エージェント向けレポートのデータ取得
 *
 * RLS により、呼び出し元ユーザーが所属する企業のデータのみが返る。
 * 集計はすべてサーバー側(必要最小限の SELECT + クライアントで分布化)。
 *
 * このファイルは「レポート土台 + D:ステータス分布」のためのもの。
 * 後続の A(成約・売上)/ B(ファネル)/ C(アドバイザー別)/ E(所要日数)も
 * このファイルに追記して育てる予定。
 *
 * Period(期間)はレポート共通の概念として最初から型付けしておく。
 * D(分布)は現在のスナップショットなので Period を使わないが、
 * A/B/C/E が使うため土台として用意する。
 */
import { createClient } from "@/lib/supabase/server";
import type { ClientStatus } from "@/lib/clients/types";
import { clientStatusLabels } from "@/lib/clients/types";
import type { ReferralStatus } from "@/lib/referrals/types";
import { referralStatusConfig } from "@/lib/referrals/types";

// ============================================
// 期間フィルタ(レポート共通)
// ============================================

export type PeriodPreset = "this-month" | "last-month" | "custom";

export type Period = {
  preset: PeriodPreset;
  /** ISO 日付(YYYY-MM-DD)。from <= to を保証 */
  from: string;
  to: string;
};

/**
 * 「今月」「先月」「任意期間」を Period に解決する。
 *
 * - JST 基準で月初・月末を計算する(エージェントは日本でしか使わない前提)。
 * - custom かつ from/to が未指定/不正の場合は this-month にフォールバック
 *   (URL 直叩きで壊れた値が来てもクラッシュしないように)。
 */
export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): Period {
  if (preset === "custom") {
    if (isValidIsoDate(customFrom) && isValidIsoDate(customTo) && customFrom <= customTo) {
      return { preset: "custom", from: customFrom, to: customTo };
    }
    // 不正な custom はフォールバック(this-month と同じ)
    preset = "this-month";
  }

  const jstNow = toJstParts(now);
  const baseYear = preset === "last-month" && jstNow.month === 1 ? jstNow.year - 1 : jstNow.year;
  const baseMonth =
    preset === "last-month" ? (jstNow.month === 1 ? 12 : jstNow.month - 1) : jstNow.month;

  const from = isoDate(baseYear, baseMonth, 1);
  // baseMonth の翌月 0 日 = baseMonth の末日
  const lastDay = new Date(Date.UTC(baseYear, baseMonth, 0)).getUTCDate();
  const to = isoDate(baseYear, baseMonth, lastDay);

  return { preset, from, to };
}

function isValidIsoDate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isoDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/** UTC の Date を JST(+9h)の年月日に変換 */
function toJstParts(d: Date): { year: number; month: number; day: number } {
  const jstMs = d.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

// ============================================
// D-1:ステータス分布(スナップショット)
// ============================================

export type StatusBucket<T extends string> = {
  status: T;
  label: string;
  count: number;
  /** Tailwind 16進(recharts に渡す用)。tailwind クラスとは別物。 */
  color: string;
};

export type StatusDistribution<T extends string> = {
  /** 並び順を保証した分布データ。0 件のステータスも含める(欠けたバケットを可視化するため) */
  buckets: StatusBucket<T>[];
  total: number;
};

/**
 * クライアント(client_records)のステータス分布を取得
 *
 * - organization スコープ(RLS で自社のみ)
 * - count select で件数だけサーバーから取り、JS で分布化
 * - 0 件のステータスも含めて返す(可視化で欠落させないため)
 *
 * 「現在の状態」を見るスナップショットなので Period は受け取らない。
 */
export async function getClientStatusDistribution(
  organizationId: string,
): Promise<StatusDistribution<ClientStatus>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("status")
    .eq("organization_id", organizationId);

  // 取得失敗時は空分布を返す(画面側で 0 件として描画される)
  const rows = error || !data ? [] : (data as Array<{ status: string }>);

  const counts = new Map<ClientStatus, number>();
  for (const row of rows) {
    const s = row.status as ClientStatus;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  const buckets: StatusBucket<ClientStatus>[] = clientStatusOrder.map((status) => ({
    status,
    label: clientStatusLabels[status],
    count: counts.get(status) ?? 0,
    color: clientStatusColors[status],
  }));

  return {
    buckets,
    total: buckets.reduce((sum, b) => sum + b.count, 0),
  };
}

/**
 * 紹介(referrals)のステータス分布を取得
 *
 * - organization スコープ(RLS で自社のみ)
 * - 並び順は referralStatusConfig の order に従う
 *   (画面側はこの順で描画してよい)
 */
export async function getReferralStatusDistribution(
  organizationId: string,
): Promise<StatusDistribution<ReferralStatus>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("referrals")
    .select("status")
    .eq("organization_id", organizationId);

  const rows = error || !data ? [] : (data as Array<{ status: string }>);

  const counts = new Map<ReferralStatus, number>();
  for (const row of rows) {
    const s = row.status as ReferralStatus;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  // referralStatusConfig は order を持つので、それに従ってソート
  const sortedConfig = [...referralStatusConfig].sort((a, b) => a.order - b.order);
  const buckets: StatusBucket<ReferralStatus>[] = sortedConfig.map((cfg) => ({
    status: cfg.value,
    label: cfg.label,
    count: counts.get(cfg.value) ?? 0,
    color: referralStatusColors[cfg.value],
  }));

  return {
    buckets,
    total: buckets.reduce((sum, b) => sum + b.count, 0),
  };
}

// ============================================
// 色定義(recharts は className を解釈できないので 16進が必要)
//
// Tailwind の色トークンと感覚を合わせるため、500 番台の HEX を採用。
// dark mode のスタイル分岐は recharts では難しいので、両モードで
// 視認できる中間の彩度に揃える(画面のクラスバッジとは別レイヤー)。
// ============================================

const clientStatusOrder: ClientStatus[] = [
  "initial_meeting",
  "job_matching",
  "in_screening",
  "offer",
  "completed",
  "declined",
];

const clientStatusColors: Record<ClientStatus, string> = {
  initial_meeting: "#94a3b8", // slate-400
  job_matching: "#3b82f6", // blue-500
  in_screening: "#8b5cf6", // violet-500
  offer: "#10b981", // emerald-500
  completed: "#059669", // emerald-600
  declined: "#ef4444", // red-500
};

const referralStatusColors: Record<ReferralStatus, string> = {
  planned: "#94a3b8", // slate-400
  recommended: "#3b82f6", // blue-500
  screening: "#6366f1", // indigo-500
  interview: "#a855f7", // purple-500
  offer: "#10b981", // emerald-500
  joined: "#059669", // emerald-600
  declined: "#ef4444", // red-500
};
