/**
 * カレンダーの期間計算ユーティリティ。
 *
 * 用途:
 *   ・M1 週 / 日ビューで、表示アンカー日(YYYY-MM-DD)から表示範囲を導く。
 *   ・週 / 日単位でのナビゲーション(前後シフト)を純粋関数で行う。
 *
 * 純粋関数化する理由:
 *   ・CalendarView は "use client" で描画されるため Date.now() 直接呼び出しを
 *     避け、アンカー日を props で受ける形にしたい。
 *   ・テスト容易性 (period.test.ts で境界ケースを担保)。
 */

export type ViewMode = "month" | "week" | "day";

export type DateRange = {
  /** YYYY-MM-DD (含む) */
  rangeStart: string;
  /** YYYY-MM-DD (含む) */
  rangeEnd: string;
};

/** YYYY-MM-DD を UTC 正午の Date に (タイムゾーン跨ぎで日付が変わるのを防ぐ) */
function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  // ローカル正午に固定 (DST の 1 時間シフトでも日付が変わらない)
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12, 0, 0, 0);
}

/**
 * 週の開始日を返す (日曜始まり。Sunday = 0)。
 * 例: 2026-07-09 (木) → 2026-07-05 (日)
 */
export function getWeekStart(ymd: string): string {
  const d = parseYmd(ymd);
  const dow = d.getDay(); // 0=日
  return toYmd(addDays(d, -dow));
}

/** 週の範囲 (日曜〜土曜) */
export function getWeekRange(ymd: string): DateRange {
  const start = getWeekStart(ymd);
  const end = toYmd(addDays(parseYmd(start), 6));
  return { rangeStart: start, rangeEnd: end };
}

/** 単日の範囲 (自身のみ) */
export function getDayRange(ymd: string): DateRange {
  return { rangeStart: ymd, rangeEnd: ymd };
}

/** 月の範囲 (前月末 1 週 + 当月 + 翌月頭 1 週 = 月ビューグリッド用) */
export function getMonthRange(ymd: string): DateRange {
  const d = parseYmd(ymd);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const start = new Date(y, m - 1, 1 - 7, 12, 0, 0, 0);
  const end = new Date(y, m, 7, 12, 0, 0, 0);
  return { rangeStart: toYmd(start), rangeEnd: toYmd(end) };
}

/**
 * ビューモードごとのナビゲーション (前後シフト)。
 *   ・month: 1 ヶ月
 *   ・week : 7 日
 *   ・day  : 1 日
 * 返り値は「新しいアンカー日」の YYYY-MM-DD。
 */
export function shiftAnchor(ymd: string, mode: ViewMode, delta: number): string {
  const d = parseYmd(ymd);
  if (mode === "day") return toYmd(addDays(d, delta));
  if (mode === "week") return toYmd(addDays(d, delta * 7));
  // month: getMonth() 側で 12 の繰り上げ / -1 の繰り下げは Date が吸収する
  return toYmd(new Date(d.getFullYear(), d.getMonth() + delta, d.getDate(), 12, 0, 0, 0));
}

/**
 * ビューモードごとの範囲 (fetch レンジ) 導出。 CalendarView 経由 の fetch 用。
 * 週 / 日は当該範囲、 月は月ビューグリッド用の前後 1 週込み。
 */
export function rangeForView(ymd: string, mode: ViewMode): DateRange {
  if (mode === "day") return getDayRange(ymd);
  if (mode === "week") return getWeekRange(ymd);
  return getMonthRange(ymd);
}

/** ヘッダー表示ラベル (ja-JP) */
export function formatPeriodLabel(ymd: string, mode: ViewMode): string {
  const d = parseYmd(ymd);
  if (mode === "day") {
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  }
  if (mode === "week") {
    const { rangeStart, rangeEnd } = getWeekRange(ymd);
    const s = parseYmd(rangeStart);
    const e = parseYmd(rangeEnd);
    // 「2026年7月5日 - 11日」形式 (跨月なら「2026年7月28日 - 8月3日」)
    const sFmt = `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日`;
    const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    const eFmt = sameMonth ? `${e.getDate()}日` : `${e.getMonth() + 1}月${e.getDate()}日`;
    return `${sFmt} - ${eFmt}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}
