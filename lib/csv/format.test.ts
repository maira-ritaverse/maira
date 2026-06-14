import { describe, it, expect } from "vitest";
import { buildCsvFilename, csvFormat, escapeCsvCell, toCsv } from "./format";

/**
 * CSV ユーティリティのテスト。
 *
 * escapeCsvCell はセキュリティ責務(CSV インジェクション対策)を持つため、
 * 「Excel/Sheets が式として評価しない形になっている」ことを境界ごとに検証する。
 * toCsv / csvFormat / buildCsvFilename は組み立ての契約をテストする。
 */

describe("escapeCsvCell — CSV injection 対策", () => {
  it("= で始まる値は ' を前置する(数式扱いを無効化)", () => {
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
  });

  it("+ - @ で始まる値も同様に ' を前置する", () => {
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("-100")).toBe("'-100");
    expect(escapeCsvCell("@mention")).toBe("'@mention");
  });

  it("TAB / CR で始まる値も ' を前置する(Sheets が式扱いするケース)", () => {
    expect(escapeCsvCell("\tinjected")).toBe("'\tinjected");
    expect(escapeCsvCell("\rinjected")).toBe('"\'\rinjected"'); // CR は引用も必要
  });

  it("途中に = + - @ があるだけなら ' は付けない(先頭文字のみ判定)", () => {
    expect(escapeCsvCell("a=b")).toBe("a=b");
    expect(escapeCsvCell("normal-text")).toBe("normal-text");
  });

  it("通常文字列はそのまま返す", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell("日本語")).toBe("日本語");
    expect(escapeCsvCell("")).toBe("");
  });
});

describe("escapeCsvCell — RFC 4180 引用エスケープ", () => {
  it('カンマを含む値は " で囲む', () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
  });

  it('改行(LF / CRLF)を含む値は " で囲む', () => {
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
    expect(escapeCsvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it('ダブルクォートを含む値は "" に二重化して " で囲む', () => {
    expect(escapeCsvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("インジェクション対策と引用エスケープが重なるケースを正しく処理", () => {
    // 先頭が = で、かつカンマも含む → 両方適用
    expect(escapeCsvCell("=A1,B2")).toBe('"\'=A1,B2"');
  });
});

describe("toCsv", () => {
  it("空配列なら BOM のみ(末尾改行なし)を返す", () => {
    expect(toCsv([])).toBe("﻿");
  });

  it("ヘッダ + 1 行を CRLF で結合し BOM 付きで返す", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["1", "2"],
      ]),
    ).toBe("﻿a,b\r\n1,2\r\n");
  });

  it("各セルが個別にエスケープされる", () => {
    expect(toCsv([["a,b", '"q"']])).toBe('﻿"a,b","""q"""\r\n');
  });

  it("行ごとに CRLF で区切る(LF 単独では区切らない)", () => {
    const out = toCsv([["a"], ["b"], ["c"]]);
    expect(out).toBe("﻿a\r\nb\r\nc\r\n");
  });
});

describe("csvFormat ヘルパー", () => {
  it("text: null/undefined は空文字、文字列はそのまま", () => {
    expect(csvFormat.text(null)).toBe("");
    expect(csvFormat.text(undefined)).toBe("");
    expect(csvFormat.text("")).toBe("");
    expect(csvFormat.text("abc")).toBe("abc");
  });

  it("number: null/undefined は空文字、数値は String(v)", () => {
    expect(csvFormat.number(null)).toBe("");
    expect(csvFormat.number(undefined)).toBe("");
    expect(csvFormat.number(0)).toBe("0"); // 0 を空にしない(意味のある数値)
    expect(csvFormat.number(123)).toBe("123");
    expect(csvFormat.number(-5)).toBe("-5");
    expect(csvFormat.number(1.5)).toBe("1.5");
  });

  it("isoDateTime: ISO 文字列を YYYY-MM-DD HH:mm 形式に切る", () => {
    expect(csvFormat.isoDateTime("2026-06-14T15:30:45.123Z")).toBe("2026-06-14 15:30");
    expect(csvFormat.isoDateTime(null)).toBe("");
    expect(csvFormat.isoDateTime("")).toBe("");
  });

  it("isoDateTime: 時刻部が無いものは日付だけ返す(空白追加なし)", () => {
    expect(csvFormat.isoDateTime("2026-06-14")).toBe("2026-06-14");
  });

  it("dateOnly: 先頭 10 文字を返す(ISO 想定)", () => {
    expect(csvFormat.dateOnly("2026-06-14T15:30:45Z")).toBe("2026-06-14");
    expect(csvFormat.dateOnly("2026-06-14")).toBe("2026-06-14");
    expect(csvFormat.dateOnly(null)).toBe("");
  });

  it("bool: true → '1' / false → '0' / null|undefined → ''", () => {
    expect(csvFormat.bool(true)).toBe("1");
    expect(csvFormat.bool(false)).toBe("0");
    expect(csvFormat.bool(null)).toBe("");
    expect(csvFormat.bool(undefined)).toBe("");
  });
});

describe("buildCsvFilename", () => {
  it("prefix_YYYYMMDD_HHmm.csv 形式で組み立てる", () => {
    // ローカルタイムの月日時分を使うので、Date(yyyy, mm, dd, hh, mi) を渡せば
    // タイムゾーンに依存せず値が一致する。
    const fixed = new Date(2026, 5, 14, 9, 30); // 2026-06-14 09:30 ローカル
    expect(buildCsvFilename("jobs", fixed)).toBe("jobs_20260614_0930.csv");
  });

  it("時・分を 0 埋めする", () => {
    const fixed = new Date(2026, 0, 1, 0, 5); // 1 月 1 日 00:05
    expect(buildCsvFilename("clients", fixed)).toBe("clients_20260101_0005.csv");
  });

  it("prefix はそのまま使われる(エスケープしない契約)", () => {
    const fixed = new Date(2026, 5, 14, 12, 0);
    expect(buildCsvFilename("ma-send-logs", fixed)).toBe("ma-send-logs_20260614_1200.csv");
  });
});
