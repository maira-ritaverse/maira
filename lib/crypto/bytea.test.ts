import { describe, it, expect } from "vitest";
import { byteaToText, textToByteaInput } from "./bytea";

/**
 * bytea ⇄ 文字列の相互変換テスト。
 *
 * このモジュールは過去に supabase-js が Buffer を JSON 化して bytea を壊した
 * バグへの対策として作られた。`\xHEX` 形式の入力 / 3 種類の出力フォーマット
 * (\\x hex / base64 / Uint8Array)を受け取れることが契約。
 *
 * 文字列の往復(text → bytea → text)が ASCII / 日本語 / 絵文字で破綻しないかを
 * 境界ごとに固める。想定外の入力で例外を投げず空文字に倒す UI 防御もテスト。
 */

describe("textToByteaInput — 出力形式", () => {
  it("ASCII 文字列は \\xHEX 形式(小文字 hex)で返る", () => {
    expect(textToByteaInput("abc")).toBe("\\x616263");
  });

  it("空文字は \\x のみ(hex 部分が空)", () => {
    expect(textToByteaInput("")).toBe("\\x");
  });

  it("日本語(UTF-8 マルチバイト)は 3 バイトずつ hex 化される", () => {
    // 「あ」は UTF-8 で E3 81 82
    expect(textToByteaInput("あ")).toBe("\\xe38182");
  });

  it("絵文字(サロゲートペア)も正しく UTF-8 hex 化される", () => {
    // 🎉 は U+1F389、UTF-8 で F0 9F 8E 89
    expect(textToByteaInput("🎉")).toBe("\\xf09f8e89");
  });
});

describe("byteaToText — 入力形式 1: \\xHEX", () => {
  it("\\xHEX 形式の hex 文字列を UTF-8 にデコード", () => {
    expect(byteaToText("\\x616263")).toBe("abc");
  });

  it("空 hex(\\x のみ)は空文字", () => {
    expect(byteaToText("\\x")).toBe("");
  });

  it("日本語の hex を正しくデコード", () => {
    expect(byteaToText("\\xe38182")).toBe("あ");
  });
});

describe("byteaToText — 入力形式 2: Base64", () => {
  it("base64 文字列(\\x プレフィックス無し)を UTF-8 にデコード", () => {
    // "abc" は base64 で "YWJj"
    expect(byteaToText("YWJj")).toBe("abc");
  });

  it("日本語の base64 も正しくデコード", () => {
    // "あ"(UTF-8 で E3 81 82)は base64 で "44GC"
    expect(byteaToText("44GC")).toBe("あ");
  });
});

describe("byteaToText — 入力形式 3: Uint8Array", () => {
  it("Uint8Array を UTF-8 にデコード", () => {
    expect(byteaToText(new Uint8Array([0x61, 0x62, 0x63]))).toBe("abc");
  });

  it("日本語の Uint8Array(マルチバイト)もデコード", () => {
    expect(byteaToText(new Uint8Array([0xe3, 0x81, 0x82]))).toBe("あ");
  });

  it("空 Uint8Array は空文字", () => {
    expect(byteaToText(new Uint8Array([]))).toBe("");
  });
});

describe("byteaToText — 想定外入力(UI crash 防止)", () => {
  it("null / undefined は空文字", () => {
    expect(byteaToText(null)).toBe("");
    expect(byteaToText(undefined)).toBe("");
  });

  it("数値 / boolean / オブジェクトも空文字(例外を投げない契約)", () => {
    expect(byteaToText(123)).toBe("");
    expect(byteaToText(true)).toBe("");
    expect(byteaToText({})).toBe("");
    expect(byteaToText([])).toBe("");
  });
});

describe("textToByteaInput → byteaToText のラウンドトリップ", () => {
  function roundtrip(text: string): string {
    return byteaToText(textToByteaInput(text));
  }

  it("ASCII 文字列の往復は元と同一", () => {
    expect(roundtrip("Hello, World!")).toBe("Hello, World!");
  });

  it("日本語の往復は元と同一", () => {
    expect(roundtrip("こんにちは、世界")).toBe("こんにちは、世界");
  });

  it("絵文字の往復は元と同一", () => {
    expect(roundtrip("🎉🎊✨")).toBe("🎉🎊✨");
  });

  it("空文字の往復は空文字", () => {
    expect(roundtrip("")).toBe("");
  });

  it("改行・タブ・特殊文字を含んでも往復可能", () => {
    expect(roundtrip("line1\nline2\ttab\r\nwindows")).toBe("line1\nline2\ttab\r\nwindows");
  });

  it("JSON 文字列(encrypted_payload で使う形式)の往復", () => {
    const json = JSON.stringify({ kind: "test", data: [1, 2, 3], name: "田中" });
    expect(roundtrip(json)).toBe(json);
  });
});
