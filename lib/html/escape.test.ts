import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escape";

/**
 * HTML エスケープの直接テスト。
 *
 * 履歴書 / 職務経歴書 HTML ビルダーのテストでも間接的にカバーされているが、
 * セキュリティ責務(XSS 防御)なので、5 文字の個別エスケープと「二重 amp が
 * 発生しない順序保証」を直接 assert で固定する。
 */

describe("escapeHtml — 5 文字の個別エスケープ", () => {
  it("< → &lt;", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  it("> → &gt;", () => {
    expect(escapeHtml(">")).toBe("&gt;");
  });

  it("& → &amp;", () => {
    expect(escapeHtml("&")).toBe("&amp;");
  });

  it('" → &quot;', () => {
    expect(escapeHtml('"')).toBe("&quot;");
  });

  it("' → &#39;(古いブラウザ向けに &apos; ではなく数値参照)", () => {
    expect(escapeHtml("'")).toBe("&#39;");
  });
});

describe("escapeHtml — XSS 攻撃ベクトル", () => {
  it("<script> タグは無害化される", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("</body> 注入は閉じタグの早期終端を防ぐ", () => {
    const r = escapeHtml("abc</body><script>evil()</script>");
    expect(r).not.toContain("</body>");
    expect(r).not.toContain("<script>");
  });

  it("属性値の脱出('attr-name'='val' をクォートで突破)を防ぐ", () => {
    const r = escapeHtml('" onerror="alert(1)');
    expect(r).not.toContain('"');
    expect(r).toContain("&quot;");
  });

  it("シングルクォート属性脱出も防ぐ", () => {
    const r = escapeHtml("' onmouseover='alert(1)");
    expect(r).not.toContain("'");
    expect(r).toContain("&#39;");
  });
});

describe("escapeHtml — 二重エスケープ防止(置換順序)", () => {
  it("& は最初に置換されるので、他の置換結果に二重 &amp; が付かない", () => {
    // 順序が逆だと「& → &amp;」が「< → &lt;」の置換結果(&lt;)を
    // 「&amp;lt;」のように二重置換してしまう
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("<")).not.toBe("&amp;lt;");
  });

  it("ユーザー入力に '&amp;' が含まれていても二重エスケープしない契約は維持しない", () => {
    // この関数は「生の HTML エンティティを尊重する」契約ではなく、
    // 「& は必ず &amp; にする」契約。入力の "&amp;" は "&amp;amp;" になる。
    // 呼び出し側で「既にエスケープ済み文字列を再 escape しない」責任。
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("escapeHtml — 通常文字列・空文字", () => {
  it("通常の英数字はそのまま", () => {
    expect(escapeHtml("Hello, World 123")).toBe("Hello, World 123");
  });

  it("日本語(マルチバイト)はそのまま", () => {
    expect(escapeHtml("こんにちは、世界")).toBe("こんにちは、世界");
  });

  it("絵文字(サロゲートペア)もそのまま", () => {
    expect(escapeHtml("🎉🎊")).toBe("🎉🎊");
  });

  it("空文字は空文字", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("escapeHtml — 混在ケース", () => {
  it("複数の対象文字が混在しても全部置換される", () => {
    expect(escapeHtml("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("同じ文字が複数回出てきても全部置換される", () => {
    expect(escapeHtml("<<>>")).toBe("&lt;&lt;&gt;&gt;");
  });
});
