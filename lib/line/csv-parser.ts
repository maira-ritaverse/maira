/**
 * LINE Official Account Manager の チャット履歴 CSV パーサ
 *
 * LINE の CSV 仕様 は 公式 ドキュメント が ない ので、 一般化 した パーサ で 対応:
 *
 * 想定 列 構成 (いずれか):
 *   日時, 送信者, メッセージ種別, 内容
 *   時刻, 差出人, タイプ, テキスト
 *   等 (列名 は ヘッダ で 自動 マッピング)
 *
 * 必須:
 *   ・1 行 1 メッセージ
 *   ・「日時 / 時刻 / timestamp」 を 含む 列
 *   ・「送信者 / 差出人 / sender」 を 含む 列
 *   ・「内容 / 本文 / text / メッセージ」 を 含む 列
 *
 * 制約:
 *   ・テキスト メッセージ のみ 対応 (スタンプ / 画像 等 は スキップ)
 *   ・日時 形式 は ISO / 「YYYY-MM-DD HH:mm:ss」 / 「YYYY/MM/DD HH:mm」 を 受ける
 *
 * direction の 判定:
 *   ・selfSenderLabel が マッチ する 行 → outbound
 *   ・それ以外 → inbound
 */

export type ParsedHistoryMessage = {
  direction: "inbound" | "outbound";
  text: string;
  createdAt: string; // ISO
  // CSV 行 ハッシュ (重複 防止)
  rowHash: string;
};

export type ParseResult =
  | {
      ok: true;
      messages: ParsedHistoryMessage[];
      skipped: number;
      total: number;
    }
  | {
      ok: false;
      error: string;
    };

const TIMESTAMP_KEYS = ["日時", "時刻", "timestamp", "datetime", "date", "time"];
const SENDER_KEYS = ["送信者", "差出人", "sender", "from", "author"];
const TEXT_KEYS = ["内容", "本文", "メッセージ", "text", "message", "content", "body"];

export function parseLineHistoryCsv(csvText: string, selfSenderLabels: string[]): ParseResult {
  // BOM 除去
  const cleaned = csvText.replace(/^﻿/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: "empty_or_header_only" };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const timestampIdx = findColumnIdx(header, TIMESTAMP_KEYS);
  const senderIdx = findColumnIdx(header, SENDER_KEYS);
  const textIdx = findColumnIdx(header, TEXT_KEYS);

  if (timestampIdx < 0 || senderIdx < 0 || textIdx < 0) {
    return {
      ok: false,
      error: `header_missing: timestamp=${timestampIdx} sender=${senderIdx} text=${textIdx} / 列=${header.join(",")}`,
    };
  }

  const selfSet = new Set(selfSenderLabels.map((s) => s.trim().toLowerCase()));
  const messages: ParsedHistoryMessage[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const rawTs = cells[timestampIdx]?.trim();
    const rawSender = cells[senderIdx]?.trim() ?? "";
    const rawText = cells[textIdx]?.trim();
    if (!rawTs || !rawText) {
      skipped += 1;
      continue;
    }
    const iso = parseTimestamp(rawTs);
    if (!iso) {
      skipped += 1;
      continue;
    }
    const direction: "inbound" | "outbound" = selfSet.has(rawSender.toLowerCase())
      ? "outbound"
      : "inbound";
    messages.push({
      direction,
      text: rawText,
      createdAt: iso,
      rowHash: simpleHash(`${iso}|${direction}|${rawText}`),
    });
  }

  return { ok: true, messages, skipped, total: lines.length - 1 };
}

function findColumnIdx(header: string[], candidates: string[]): number {
  for (let i = 0; i < header.length; i += 1) {
    for (const c of candidates) {
      if (header[i].includes(c)) return i;
    }
  }
  return -1;
}

function parseTimestamp(s: string): string | null {
  // 候補: 2026-06-20 15:47:00 / 2026/06/20 15:47 / ISO 8601
  const isoTry = new Date(s);
  if (!Number.isNaN(isoTry.getTime())) return isoTry.toISOString();
  // YYYY/MM/DD HH:MM
  const m = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? "0"),
    );
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** 簡易 CSV 行 パース (ダブルクォート 対応) */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else {
      if (c === ",") {
        result.push(current);
        current = "";
      } else if (c === '"') {
        inQuotes = true;
      } else {
        current += c;
      }
    }
  }
  result.push(current);
  return result;
}

/** djb2 ハッシュ (重複 検出 用、 衝突 確率 は 実用上 問題なし) */
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
