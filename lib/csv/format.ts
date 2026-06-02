/**
 * CSV 出力ユーティリティ
 *
 * 目的:
 *   - Excel(日本語環境)で文字化けしないよう UTF-8 BOM を先頭に付ける
 *   - CSV インジェクション対策:= + - @ TAB CR で始まる値は ' を前置し、
 *     式として実行されないようにする(Excel/Google Sheets/Numbers 共通対策)
 *   - 値内のダブルクォート・カンマ・改行を RFC 4180 に従ってエスケープ
 *
 * ⚠️ 数値・日付・null は呼び出し側で文字列化してから渡す。
 *    本関数は文字列にしか責任を持たない(型ごとの整形は表計算側でやってもらう前提)。
 */

const BOM = "﻿";

// CSV インジェクション攻撃の対象になる先頭文字。
// Excel/Sheets/Numbers などは = + - @ で始まるセルを式として解釈し、
// HYPERLINK/IMPORTXML 経由で外部通信や任意コマンド実行に繋がるケースがある。
// TAB(0x09)と CR(0x0D)も Sheets が式扱いするので一緒に潰す。
const INJECTION_PREFIX = /^[=+\-@\t\r]/;

/**
 * 1セル分の値を CSV 安全な文字列にエスケープする。
 *
 * 手順:
 *   1) インジェクション対策で先頭が危険文字なら ' を前置(値そのものは保つ)
 *   2) " を "" に二重化
 *   3) " or , or \r or \n を含む場合は全体を " で囲む
 */
export function escapeCsvCell(raw: string): string {
  let value = raw;

  if (INJECTION_PREFIX.test(value)) {
    value = `'${value}`;
  }

  const needsQuoting = /[",\r\n]/.test(value);
  const doubled = value.replace(/"/g, '""');
  return needsQuoting ? `"${doubled}"` : doubled;
}

/**
 * 2 次元配列(ヘッダ含む)を CSV 文字列に変換する。
 * 改行は CRLF(RFC 4180 準拠、Excel での読み込みも安全)。
 * 先頭に UTF-8 BOM を付与する。
 */
export function toCsv(rows: string[][]): string {
  const body = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  return BOM + body + (body.length > 0 ? "\r\n" : "");
}

/**
 * 値を文字列に整形するヘルパー集。
 * 列ごとに「数値は半角数字」「null は空文字」など細かな整形を統一するため。
 */
export const csvFormat = {
  text(v: string | null | undefined): string {
    return v ?? "";
  },
  /** 数値はそのまま半角で。null/undefined は空文字。 */
  number(v: number | null | undefined): string {
    if (v === null || v === undefined) return "";
    return String(v);
  },
  /** ISO 文字列 → YYYY-MM-DD HH:mm(ローカルではなく ISO の表記でそのまま切る)。 */
  isoDateTime(v: string | null | undefined): string {
    if (!v) return "";
    // 'YYYY-MM-DDTHH:mm:ss...' → 'YYYY-MM-DD HH:mm'
    const date = v.slice(0, 10);
    const time = v.slice(11, 16);
    return time ? `${date} ${time}` : date;
  },
  /** 'YYYY-MM-DD' のような既に日付文字列のもの。null は空。 */
  dateOnly(v: string | null | undefined): string {
    if (!v) return "";
    return v.slice(0, 10);
  },
  /** boolean → "1" / "0"(Excel 互換重視) */
  bool(v: boolean | null | undefined): string {
    if (v === null || v === undefined) return "";
    return v ? "1" : "0";
  },
};

/**
 * ダウンロード用のファイル名を「<prefix>_YYYYMMDD_HHmm.csv」形式で組み立てる。
 * 日本語を含む prefix を渡すケースに備え、ASCII safe な英数_アンスコのみに限定する想定で
 * 呼び出し側は英字 prefix を渡すこと。
 */
export function buildCsvFilename(prefix: string, now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${prefix}_${yyyy}${mm}${dd}_${hh}${mi}.csv`;
}
