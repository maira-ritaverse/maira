import { describe, it, expect } from "vitest";
import { isSafeNextPath, safeNextOr } from "./safe-next";

/**
 * open redirect 対策の境界テスト。
 *
 * /login?next=... のような戻り先 URL を緩く受け入れると、フィッシング攻撃で
 * 任意の外部サイトに飛ばされる(open redirect)。このフィルタが「同一オリジン
 * 内のパスだけ通す」契約を維持していることが、セキュリティ上の生命線。
 *
 * scheme-relative URL("//evil.com") や Windows パス("\\evil.com")等、
 * 「うっかり通ってしまう書き方」を全部禁止できているか境界ごとに固める。
 */

describe("isSafeNextPath — 通すケース", () => {
  it("単純なパス", () => {
    expect(isSafeNextPath("/")).toBe(true);
    expect(isSafeNextPath("/app")).toBe(true);
    expect(isSafeNextPath("/invite/abc")).toBe(true);
  });

  it("クエリパラメータ付き", () => {
    expect(isSafeNextPath("/login?x=1")).toBe(true);
    expect(isSafeNextPath("/app?next=/foo&y=2")).toBe(true);
  });

  it("ハッシュ付き", () => {
    expect(isSafeNextPath("/app#section")).toBe(true);
  });

  it("マルチバイト文字を含むパス(日本語)", () => {
    expect(isSafeNextPath("/求人/123")).toBe(true);
  });
});

describe("isSafeNextPath — 弾くケース(open redirect 対策)", () => {
  it("null / undefined / 空文字", () => {
    expect(isSafeNextPath(null)).toBe(false);
    expect(isSafeNextPath(undefined)).toBe(false);
    expect(isSafeNextPath("")).toBe(false);
  });

  it("scheme-relative URL は弾く('//evil.com/x' で他オリジンに飛ぶ攻撃)", () => {
    expect(isSafeNextPath("//evil.com")).toBe(false);
    expect(isSafeNextPath("//evil.com/path")).toBe(false);
    expect(isSafeNextPath("//")).toBe(false);
  });

  it("絶対 URL は弾く", () => {
    expect(isSafeNextPath("https://evil.com")).toBe(false);
    expect(isSafeNextPath("http://example.com")).toBe(false);
    expect(isSafeNextPath("HTTP://evil.com")).toBe(false);
  });

  it("javascript: などの scheme は弾く(/ で始まらない)", () => {
    expect(isSafeNextPath("javascript:alert(1)")).toBe(false);
    expect(isSafeNextPath("data:text/html,abc")).toBe(false);
    expect(isSafeNextPath("file:///etc/passwd")).toBe(false);
  });

  it("/ で始まらない相対パスは弾く", () => {
    expect(isSafeNextPath("foo")).toBe(false);
    expect(isSafeNextPath("./foo")).toBe(false);
    expect(isSafeNextPath("../foo")).toBe(false);
  });

  it("Windows パス区切り(\\)を含むパスは弾く(\\\\evil.com で回避を試みるケース)", () => {
    expect(isSafeNextPath("\\\\evil.com")).toBe(false);
    expect(isSafeNextPath("/foo\\bar")).toBe(false);
    expect(isSafeNextPath("/\\evil.com")).toBe(false);
  });
});

describe("safeNextOr", () => {
  it("安全な next を渡したらそのまま返す", () => {
    expect(safeNextOr("/app", "/fallback")).toBe("/app");
    expect(safeNextOr("/agency/clients?x=1", "/")).toBe("/agency/clients?x=1");
  });

  it("不正な next なら fallback を返す", () => {
    expect(safeNextOr("//evil.com", "/app")).toBe("/app");
    expect(safeNextOr("https://evil.com", "/app")).toBe("/app");
    expect(safeNextOr("javascript:alert(1)", "/app")).toBe("/app");
    expect(safeNextOr(null, "/app")).toBe("/app");
    expect(safeNextOr(undefined, "/app")).toBe("/app");
    expect(safeNextOr("", "/app")).toBe("/app");
  });

  it("fallback がそもそも不正でも返ってしまう(呼び出し側の責任で安全なものを渡す契約)", () => {
    // この関数は fallback を再検証しない(呼び出し側が安全なものを渡す前提)
    // 異常系を許容することのドキュメント代わり
    expect(safeNextOr(null, "//evil.com")).toBe("//evil.com");
  });
});
