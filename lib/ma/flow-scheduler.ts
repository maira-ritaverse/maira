/**
 * Flow ステップ の 次回 実行 時刻 (next_action_at) 計算 と 送信 時間帯 制約 の 評価。
 *
 * 純粋 関数 の 集まり (Supabase を 呼ばない)。 実際 の 集計 (日次 送信数 の 取得 等) は
 * flow-executor.ts 側 で 行う。
 *
 * Phase 1 は tz='Asia/Tokyo' 固定 前提 で 実装 する (Maira は 日本 向け 単一 tz)。
 * 拡張 する 場合 は Intl API か date-fns-tz 導入 を 検討。
 */
import { z } from "zod";

/**
 * 送信 時間帯 の 制約 JSON スキーマ。
 * ma_flows.send_time_window_json に 格納 される 構造。
 */
export const SendTimeWindowSchema = z.object({
  only_between: z.object({
    // "HH:MM" 24 時間 表記
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    // IANA time zone。 Phase 1 は "Asia/Tokyo" 固定 想定
    tz: z.string().default("Asia/Tokyo"),
  }),
});
export type SendTimeWindow = z.infer<typeof SendTimeWindowSchema>;

/**
 * 送信 時間帯 制約 の JSON を 安全 に parse する。 不正 な JSON は null を 返す。
 */
export function parseSendTimeWindow(raw: unknown): SendTimeWindow | null {
  if (raw == null) return null;
  const parsed = SendTimeWindowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * 「HH:MM」文字列 を 「その 日 の 00:00 から の 分数」 に 変換。
 */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  return h * 60 + m;
}

/**
 * UTC 時刻 を Asia/Tokyo (+9h) の 「その 日 の 00:00 から の 分数」 に 変換。
 */
function utcToJstMinutes(t: Date): number {
  const jst = new Date(t.getTime() + 9 * 3600 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

/**
 * 指定 時刻 が 送信 時間帯 内 か 判定。 window が null なら 常に true。
 */
export function isWithinSendTimeWindow(t: Date, window: SendTimeWindow | null): boolean {
  if (!window) return true;
  const { start, end } = window.only_between;
  const cur = utcToJstMinutes(t);
  const sMin = hhmmToMinutes(start);
  const eMin = hhmmToMinutes(end);
  // start ≤ end なら 通常。 start > end なら 夜跨ぎ (例: 22:00 - 06:00)。
  if (sMin <= eMin) {
    return cur >= sMin && cur < eMin;
  }
  return cur >= sMin || cur < eMin;
}

/**
 * 指定 時刻 が 窓 外 なら 「次 の 窓 開始 時刻」 を UTC で 返す。
 * 内 なら そのまま。
 */
export function shiftToWithinWindow(t: Date, window: SendTimeWindow | null): Date {
  if (!window) return t;
  if (isWithinSendTimeWindow(t, window)) return t;

  const { start } = window.only_between;
  const [sh, sm] = start.split(":").map((s) => Number(s));

  // JST 換算 して 「今日 の start」 を 組み立て、 過ぎ て いれば 翌日 に。
  const jst = new Date(t.getTime() + 9 * 3600 * 1000);
  const target = new Date(jst);
  target.setUTCHours(sh, sm, 0, 0);
  if (target.getTime() <= jst.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  // JST → UTC
  return new Date(target.getTime() - 9 * 3600 * 1000);
}

/**
 * ステップ の delay_from_previous_seconds を 基準 時刻 に 足し、
 * 送信 時間帯 制約 が あれば その 範囲 に シフト。
 *
 * @param baseTime      前 ステップ 完了 or トリガー 発火 の 基準 時刻
 * @param delaySeconds  次 ステップ まで の 遅延 秒
 * @param window        送信 時間帯 制約 (Flow 単位、 null 可)
 */
export function computeNextActionAt(
  baseTime: Date,
  delaySeconds: number,
  window: SendTimeWindow | null,
): Date {
  const raw = new Date(baseTime.getTime() + delaySeconds * 1000);
  return shiftToWithinWindow(raw, window);
}

/**
 * 日次 送信上限 に 達し た か 判定。 max が null なら 常に false (無制限)。
 */
export function isDailyLimitReached(
  sentToday: number,
  maxPerDay: number | null | undefined,
): boolean {
  if (maxPerDay == null) return false;
  return sentToday >= maxPerDay;
}

/**
 * 「翌日 00:00 UTC」を 返す (日次上限 到達時 の 遅延 先)。
 */
export function nextDayStartUtc(now: Date): Date {
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow;
}
