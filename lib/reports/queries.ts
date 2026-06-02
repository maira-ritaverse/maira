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
import { aggregatePlacements } from "@/lib/placements/aggregate";
import type { Placement, PlacementEventType, PaymentStatus } from "@/lib/placements/types";

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

// ============================================
// A:成約数・売上(月別)
// ============================================

export type MonthlyDealsBucket = {
  /** YYYY-MM(チャート横軸の識別子) */
  month: string;
  /** チャート表示用ラベル(例: "2026/06") */
  label: string;
  /** 成約イベント(event_type='placement')の件数 */
  placementCount: number;
  /** 純売上 = placement + additional − refund(円、整数) */
  netRevenue: number;
  /** 入金済み(payment 合計、円、整数) */
  paid: number;
};

export type MonthlyDealsRevenue = {
  /** 月別バケット(期間内の月をすべて含む。0 件月も埋める) */
  buckets: MonthlyDealsBucket[];
  /** 期間合計 */
  total: {
    placementCount: number;
    netRevenue: number;
    paid: number;
    placementTotal: number;
    additionalTotal: number;
    refundTotal: number;
  };
  /** 集計対象の期間(画面表示用に同梱) */
  period: Period;
};

/**
 * 期間内の placements を月別に集計して、成約数・純売上・入金済みを返す。
 *
 * ⚠️ お金の計算は `aggregatePlacements`(成約画面と同じロジック)を再利用する。
 *    レポートと成約画面で金額がズレないようにするためで、独自実装は厳禁。
 *    純売上 = placement + additional − refund(円、整数)。
 *
 * フィルタは event_date(date 型)で organization_id をサーバー側で絞る。
 * RLS でも自社のみに絞られるが、念のため二重防御。
 *
 * 月の生成は period.from / period.to から純粋に文字列処理で行う
 * (event_date は date 型でタイムゾーン無し、JST/UTC 差を持ち込まない)。
 * 0 件月もバケットに含めることで、画面で「データが無い月」を可視化する。
 */
export async function getMonthlyDealsRevenue(
  organizationId: string,
  period: Period,
): Promise<MonthlyDealsRevenue> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("placements")
    .select("id, organization_id, referral_id, event_type, amount, event_date")
    .eq("organization_id", organizationId)
    .gte("event_date", period.from)
    .lte("event_date", period.to);

  type Row = {
    id: string;
    organization_id: string;
    referral_id: string;
    event_type: string;
    amount: number | null;
    event_date: string;
  };

  const rows: Row[] = error || !data ? [] : (data as Row[]);

  // event_date から YYYY-MM を取って月別に振り分け。
  // aggregatePlacements を再利用するため、最低限のフィールドを Placement 型に詰め直す。
  // 集計に使わないフィールドは null/空でよい(aggregatePlacements は eventType と amount しか見ない)。
  const byMonth = new Map<string, Placement[]>();
  const placementCountByMonth = new Map<string, number>();

  for (const row of rows) {
    const month = row.event_date.slice(0, 7); // YYYY-MM
    const item = toPlacementForAggregate(row);
    const list = byMonth.get(month);
    if (list) list.push(item);
    else byMonth.set(month, [item]);

    if (row.event_type === "placement") {
      placementCountByMonth.set(month, (placementCountByMonth.get(month) ?? 0) + 1);
    }
  }

  // 期間内のすべての月を列挙(0 件月も含める)。
  const months = enumerateMonths(period.from, period.to);

  const buckets: MonthlyDealsBucket[] = months.map((month) => {
    const items = byMonth.get(month) ?? [];
    const agg = aggregatePlacements(items);
    return {
      month,
      label: formatMonthLabel(month),
      placementCount: placementCountByMonth.get(month) ?? 0,
      netRevenue: agg.netRevenue,
      paid: agg.paid,
    };
  });

  // 期間全体は「全 placements を一括で aggregatePlacements」する。
  // 月別合算と同じ値になるが、誤差ゼロ保証のため別ルートでも算出。
  const allItems = rows.map(toPlacementForAggregate);
  const totalAgg = aggregatePlacements(allItems);

  return {
    buckets,
    total: {
      placementCount: buckets.reduce((s, b) => s + b.placementCount, 0),
      netRevenue: totalAgg.netRevenue,
      paid: totalAgg.paid,
      placementTotal: totalAgg.placementTotal,
      additionalTotal: totalAgg.additionalTotal,
      refundTotal: totalAgg.refundTotal,
    },
    period,
  };
}

/**
 * aggregatePlacements は Placement[] を受けるので、SELECT で絞った行を最低限詰め直す。
 * 計算に使うのは eventType と amount だけなので、他のフィールドは型を満たすための null/空文字。
 */
function toPlacementForAggregate(row: {
  id: string;
  organization_id: string;
  referral_id: string;
  event_type: string;
  amount: number | null;
  event_date: string;
}): Placement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    referralId: row.referral_id,
    eventType: row.event_type as PlacementEventType,
    amount: row.amount,
    expectedSalary: null,
    commissionRate: null,
    eventDate: row.event_date,
    paymentStatus: null as PaymentStatus | null,
    notes: null,
    reason: null,
    createdByMemberId: null,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * "YYYY-MM-DD" の from/to から、含まれる月(YYYY-MM)を昇順で列挙する。
 * 日にちは丸めて月単位の包含チェックにする(月内の任意の日付が範囲に入っていれば含める)。
 */
function enumerateMonths(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const result: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
}

/** "YYYY-MM" → "2026/06" 表記。グラフの横軸ラベル用。 */
function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}/${m}`;
}

// ============================================
// B:選考ファネル(通過率)
//
// 「現在の到達段階で数える」案 C。
//   - status の順序:planned < recommended < screening < interview < offer < joined
//   - referral.status が interview なら、「面接以下を全部通過した」とみなす
//   - declined は紹介到達(母数)にのみ含める。それ以降の段階には含めない
//     (現 status が declined だと過去どこまで進んだか追えないため。
//      履歴ベース集計に拡張するなら referral_status_history を読む必要がある)
//
// 期間フィルタは referrals.created_at に対して JST 基準で適用する。
// 「期間内に新規に発生したファネル」を見る意図(成約画面の event_date 集計と
// 解釈を揃えるため、A は event_date、B は created_at で当然ズレるが
// それぞれ意味が違うので OK)。
// ============================================

export type FunnelStageKey =
  | "referred"
  | "recommended_reached"
  | "screening_reached"
  | "interview_reached"
  | "offer_reached"
  | "joined";

export type FunnelStageBucket = {
  key: FunnelStageKey;
  label: string;
  count: number;
  /** referred(母数)に対する到達率(%、小数 1 桁まで)。母数 0 なら 0 */
  passRate: number;
  /** バー色(recharts は使わず custom 描画なので HEX 直指定) */
  color: string;
};

export type SelectionFunnel = {
  stages: FunnelStageBucket[];
  /** referred(母数)= 期間内に作られた全 referral 数(declined 含む) */
  base: number;
  /** 補足:declined になっている件数(母数にのみ含まれている) */
  declinedCount: number;
  period: Period;
};

// status 順序の単一の真実(コメント・配列・index で一貫させる)。
// declined はこの順序に含めない(別系統として扱う)。
const referralStatusOrder: ReferralStatus[] = [
  "planned",
  "recommended",
  "screening",
  "interview",
  "offer",
  "joined",
];

/** ある status が、指定した最低段階以上に達しているか(declined は常に false)。 */
function reachedStage(status: ReferralStatus, minStage: ReferralStatus): boolean {
  if (status === "declined") return false;
  const a = referralStatusOrder.indexOf(status);
  const b = referralStatusOrder.indexOf(minStage);
  if (a < 0 || b < 0) return false;
  return a >= b;
}

/**
 * 選考ファネルを取得(期間内に作成された referrals に対して)。
 *
 * 各段階のカウント:
 *   - referred             : 全 referral(declined 含む。母数)
 *   - recommended_reached  : status が recommended 以上(declined 除く)
 *   - screening_reached    : status が screening   以上
 *   - interview_reached    : status が interview   以上
 *   - offer_reached        : status が offer       以上
 *   - joined               : status が joined
 *
 * 通過率は referred を 100% としたときの比率(各段階 / referred)。
 *
 * organization スコープ(RLS + 明示の eq で二重防御)。
 */
export async function getSelectionFunnel(
  organizationId: string,
  period: Period,
): Promise<SelectionFunnel> {
  const supabase = await createClient();

  // JST の [from 00:00, to+1day 00:00) で created_at を絞る。
  // 日付境界をズラさないため必ず +09:00 オフセット付きで指定する。
  const startIso = `${period.from}T00:00:00+09:00`;
  const endExclusiveIso = `${nextJstDay(period.to)}T00:00:00+09:00`;

  const { data, error } = await supabase
    .from("referrals")
    .select("status")
    .eq("organization_id", organizationId)
    .gte("created_at", startIso)
    .lt("created_at", endExclusiveIso);

  const rows: Array<{ status: string }> = error || !data ? [] : (data as Array<{ status: string }>);

  let base = 0;
  let recommended = 0;
  let screening = 0;
  let interview = 0;
  let offer = 0;
  let joined = 0;
  let declinedCount = 0;

  for (const row of rows) {
    const status = row.status as ReferralStatus;
    base += 1;
    if (status === "declined") {
      declinedCount += 1;
      continue;
    }
    if (reachedStage(status, "recommended")) recommended += 1;
    if (reachedStage(status, "screening")) screening += 1;
    if (reachedStage(status, "interview")) interview += 1;
    if (reachedStage(status, "offer")) offer += 1;
    if (reachedStage(status, "joined")) joined += 1;
  }

  const passRate = (n: number) => (base === 0 ? 0 : Math.round((n / base) * 1000) / 10);

  const stages: FunnelStageBucket[] = [
    {
      key: "referred",
      label: "紹介到達",
      count: base,
      passRate: passRate(base),
      color: "#94a3b8", // slate-400
    },
    {
      key: "recommended_reached",
      label: "推薦到達",
      count: recommended,
      passRate: passRate(recommended),
      color: "#3b82f6", // blue-500
    },
    {
      key: "screening_reached",
      label: "書類到達",
      count: screening,
      passRate: passRate(screening),
      color: "#6366f1", // indigo-500
    },
    {
      key: "interview_reached",
      label: "面接到達",
      count: interview,
      passRate: passRate(interview),
      color: "#a855f7", // purple-500
    },
    {
      key: "offer_reached",
      label: "内定到達",
      count: offer,
      passRate: passRate(offer),
      color: "#10b981", // emerald-500
    },
    {
      key: "joined",
      label: "成約",
      count: joined,
      passRate: passRate(joined),
      color: "#059669", // emerald-600
    },
  ];

  return { stages, base, declinedCount, period };
}

/** "YYYY-MM-DD" の翌日を返す。JST 境界の半開区間を作るためのヘルパー。 */
function nextJstDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  // UTC で安全に +1 日(月跨ぎ/年跨ぎは Date が処理してくれる)
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}
