/**
 * lib/csv/parse.ts のテスト
 *
 * RFC 4180 + Myaira ローカルルール(BOM 剥離・末尾改行無視・空行スキップ)を
 * 網羅する。エンコーディング検証は行わない(File API 経由で UTF-8 入力を前提)。
 */
import { describe, it, expect } from "vitest";

import { parseCsv, parseCsvAsObjects } from "./parse";

describe("parseCsv", () => {
  it("空文字は空配列", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("1 行 1 セル", () => {
    expect(parseCsv("hello")).toEqual([["hello"]]);
  });

  it("シンプルなカンマ区切り", () => {
    expect(parseCsv("a,b,c")).toEqual([["a", "b", "c"]]);
  });

  it("複数行(LF)", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("複数行(CRLF を LF に正規化)", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("末尾改行を無視する(空行を生まない)", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });

  it("BOM を剥離する", () => {
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });

  it("ダブルクォート囲み内のカンマを保持", () => {
    expect(parseCsv(`"a,b",c`)).toEqual([["a,b", "c"]]);
  });

  it("ダブルクォート囲み内の改行を保持", () => {
    expect(parseCsv(`"line1\nline2",x`)).toEqual([["line1\nline2", "x"]]);
  });

  it('ダブルクォートのエスケープ "" → "', () => {
    expect(parseCsv(`"He said ""hi""",y`)).toEqual([[`He said "hi"`, "y"]]);
  });

  it("空セルを保持(連続カンマ)", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("末尾カンマで空セルを保持", () => {
    expect(parseCsv("a,b,")).toEqual([["a", "b", ""]]);
  });

  it("先頭カンマで空セルを保持", () => {
    expect(parseCsv(",a,b")).toEqual([["", "a", "b"]]);
  });

  it("クォートが閉じていなければエラー", () => {
    expect(() => parseCsv(`"unclosed`)).toThrow(/クォート/);
  });

  it("日本語(マルチバイト)も正しく扱う", () => {
    expect(parseCsv("氏名,メール\n田中,t@x.com")).toEqual([
      ["氏名", "メール"],
      ["田中", "t@x.com"],
    ]);
  });

  it("クォート内のエスケープと外側の組み合わせ", () => {
    expect(parseCsv(`"a,b","c""d",e\n"f",g,h`)).toEqual([
      ["a,b", `c"d`, "e"],
      ["f", "g", "h"],
    ]);
  });
});

describe("parseCsvAsObjects", () => {
  it("空入力は headers/rows ともに空", () => {
    expect(parseCsvAsObjects("")).toEqual({ headers: [], rows: [] });
  });

  it("ヘッダーのみは rows 空", () => {
    expect(parseCsvAsObjects("a,b,c")).toEqual({
      headers: ["a", "b", "c"],
      rows: [],
    });
  });

  it("基本ケース", () => {
    expect(parseCsvAsObjects("a,b\n1,2\n3,4")).toEqual({
      headers: ["a", "b"],
      rows: [
        { a: "1", b: "2" },
        { a: "3", b: "4" },
      ],
    });
  });

  it("ヘッダーの前後空白をトリム", () => {
    const r = parseCsvAsObjects(" a , b \nx,y");
    expect(r.headers).toEqual(["a", "b"]);
    expect(r.rows).toEqual([{ a: "x", b: "y" }]);
  });

  it("データのセル数がヘッダーより少なければ空文字埋め", () => {
    const r = parseCsvAsObjects("a,b,c\n1,2");
    expect(r.rows).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("データのセル数がヘッダーより多ければ超過分を捨てる", () => {
    const r = parseCsvAsObjects("a,b\n1,2,3,4");
    expect(r.rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("全セル空の行はスキップ", () => {
    const r = parseCsvAsObjects("a,b\n1,2\n,\n3,4");
    expect(r.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("日本語ヘッダー + 日本語値", () => {
    const r = parseCsvAsObjects("氏名,メール\n田中太郎,tanaka@x.com");
    expect(r.headers).toEqual(["氏名", "メール"]);
    expect(r.rows).toEqual([{ 氏名: "田中太郎", メール: "tanaka@x.com" }]);
  });

  it("BOM 付きでも頭に空ヘッダーを作らない", () => {
    const r = parseCsvAsObjects("﻿氏名,メール\n田中,t@x.com");
    expect(r.headers).toEqual(["氏名", "メール"]);
  });
});
