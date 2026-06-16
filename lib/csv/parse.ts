/**
 * CSV パース(RFC 4180 準拠の最小実装、外部依存ゼロ)
 *
 * 採用理由:
 *   - 顧客名簿の取り込みで「氏名,メール,…」のような単純な CSV を扱う。
 *   - papaparse 等を追加導入すると CLAUDE.md の「勝手にライブラリを増やさない」に
 *     反するため、必要十分な機能だけ自前実装する。
 *   - Excel(SJIS)からの貼り付けは UTF-8 + 先頭 BOM が来る想定で BOM を剥がす。
 *
 * 対応する仕様:
 *   - フィールド区切り:カンマ
 *   - クォート:" で囲む。値内の " は "" にエスケープ
 *   - 改行:LF / CRLF どちらも OK
 *   - 末尾改行は無視(空行を生まない)
 *   - BOM(U+FEFF)が先頭にあれば剥がす
 *
 * 仕様外(意図的):
 *   - タブ区切り → caller 側で前処理(または将来 delimiter 引数で拡張)
 *   - 多バイトコメント文字 # → 通常データとして扱う
 *   - 引用符の中で改行は許容するが、引用符を閉じ忘れた末尾はエラーにする
 */

const BOM = "﻿";

/**
 * CSV 文字列を 2 次元配列に変換する。
 * 1 行目をヘッダーとして扱う必要があるかは呼び出し側の判断(parseCsvAsObjects を参照)。
 */
export function parseCsv(input: string): string[][] {
  if (input.length === 0) return [];

  // BOM の剥離。Windows Excel が貼り付けるケース等に対応。
  let src = input.startsWith(BOM) ? input.slice(1) : input;
  // CRLF → LF に正規化。改行検出が単純になる(クォート内も同様に LF 一本化)。
  src = src.replace(/\r\n?/g, "\n");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  // クォート内かどうか
  let inQuotes = false;
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        // RFC 4180:"" は " 1 つにエスケープ。
        if (i + 1 < len && src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        // 単独 " → クォート終了
        inQuotes = false;
        i += 1;
        continue;
      }
      // クォート内では LF も普通の文字。
      cell += ch;
      i += 1;
      continue;
    }

    // クォート外
    if (ch === '"') {
      // セルの開始位置でしかクォートを許容しないのが厳密 RFC だが、
      // 中途半端な位置で来た場合も「そのまま文字列に含める」より「クォート開始」と
      // 解釈する方が誤入力に寛容なので、緩めに採用する。
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  // 末尾セル / 行の処理。空文字 1 セル + 行頭 でも値として残るが、
  // 末尾の改行のみで終わっていた場合は「最後の空行」を生まないようにスキップ。
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (inQuotes) {
    throw new Error("CSV のクォートが閉じていません");
  }

  return rows;
}

/**
 * 1 行目をヘッダーとして、残りを Record<string, string>[] に変換する。
 *
 * - ヘッダー名は前後空白をトリムする(Excel 由来の半角空白に寛容)。
 * - 重複ヘッダーは後勝ち(警告は呼び出し側で出す前提)。
 * - データ行のセル数がヘッダーより少ない場合は空文字埋め、多い場合は超過分を切り捨て。
 * - 全セル空の行はスキップ(末尾空行のノイズ対策)。
 */
export type ParsedCsvObjects = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsvAsObjects(input: string): ParsedCsvObjects {
  const matrix = parseCsv(input);
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = matrix[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    // 全セル空の行はスキップ
    if (cells.every((c) => c.length === 0)) continue;

    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = c < cells.length ? cells[c] : "";
    }
    rows.push(obj);
  }

  return { headers, rows };
}
