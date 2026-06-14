/**
 * MA 送信履歴(/agency/marketing/logs)で使う URL クエリパラメータの解釈純関数。
 *
 * 同じ URL を UI ページ(Server Component)と CSV エクスポート API ルートの両方が
 * 受け取るため、解釈ロジックを 1 箇所に集約してテスト可能な純関数として書く。
 *
 * 設計方針:
 *   - 不正値は黙って undefined / デフォルトに倒す(URL を直接いじられても 500 にしない)
 *   - 日付・ステータスは「業務上ありえない値」を弾く守り(SQL に届く前に止める)
 *   - DB アクセスを含まないため pure(vitest で副作用なくテストできる)
 */

import type { SendLog } from "./types";

export type LogStatus = SendLog["status"]; // "sent" | "failed" | "skipped"

const VALID_STATUSES: ReadonlyArray<LogStatus> = ["sent", "failed", "skipped"];

/**
 * URL の `?status=` を SendLog のステータスに正規化。
 *
 * 未定義 / 空文字 / 想定外の文字列は undefined を返す(クエリ無しと同じ扱い)。
 * 戻り値が undefined なら listSendLogs にも何も渡さず、全ステータスが対象になる。
 */
export function parseLogStatus(raw: string | null | undefined): LogStatus | undefined {
  if (!raw) return undefined;
  return (VALID_STATUSES as ReadonlyArray<string>).includes(raw) ? (raw as LogStatus) : undefined;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * URL の `?from=YYYY-MM-DD&to=YYYY-MM-DD` を ISO 8601 範囲に正規化。
 *
 * - from は `00:00:00.000Z`、to は `23:59:59.999Z` で時刻補完する
 *   (1 日まるごとを範囲に含めるため。`to=2026-06-14` だと 6/14 全日が含まれる)
 * - 片方だけ指定もあり(以降 / 以前の片側オープン)
 * - YYYY-MM-DD でない文字列はそのまま undefined(全期間に倒す、500 にしない)
 *
 * 月日の妥当性(2026-02-30 等)までは検証しない:Postgres の timestamptz が
 * 解釈可能なら通すし、解釈できなければ SQL レイヤでエラーになる。
 * UI が type="date" を出している前提で、不正日は実質ここに来ない。
 */
export function parseLogDateRange(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
): { dateFrom?: string; dateTo?: string } {
  const dateFrom = fromRaw && DATE_REGEX.test(fromRaw) ? `${fromRaw}T00:00:00.000Z` : undefined;
  const dateTo = toRaw && DATE_REGEX.test(toRaw) ? `${toRaw}T23:59:59.999Z` : undefined;
  return { dateFrom, dateTo };
}

/**
 * URL の `?page=N` を 1 始まりのページ番号に正規化。
 *
 * - 未定義 / 不正値 / 0 以下は 1 に倒す
 * - 小数(2.5)は floor(2)
 * - Infinity / NaN は 1 に倒す
 *
 * UI 側で「次へ」を押せば必ず正の整数が入るので、1 にフォールバックされるのは
 * URL を直接いじられたケースだけ。
 */
export function parseLogPage(raw: string | null | undefined): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}
