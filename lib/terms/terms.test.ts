import { describe, it, expect } from "vitest";

import { needsToAcceptTerms } from "./terms";
import { CURRENT_TERMS_VERSION } from "./terms-content";
import { buildTermsHtml } from "./terms-html";

describe("needsToAcceptTerms", () => {
  it("未同意 → true", () => {
    expect(
      needsToAcceptTerms({ acceptedAt: null, version: null, signerName: null, queryOk: true }),
    ).toBe(true);
  });

  it("旧バージョンに同意済 → true(再同意が必要)", () => {
    expect(
      needsToAcceptTerms({
        acceptedAt: "2026-01-01T00:00:00Z",
        version: "2020-01-01",
        signerName: "山田",
        queryOk: true,
      }),
    ).toBe(true);
  });

  it("現行バージョンに同意済 → false", () => {
    expect(
      needsToAcceptTerms({
        acceptedAt: "2026-01-01T00:00:00Z",
        version: CURRENT_TERMS_VERSION,
        signerName: "山田",
        queryOk: true,
      }),
    ).toBe(false);
  });

  it("クエリ失敗(queryOk=false)→ false(fail-open でロックアウトを防ぐ)", () => {
    expect(
      needsToAcceptTerms({ acceptedAt: null, version: null, signerName: null, queryOk: false }),
    ).toBe(false);
  });
});

describe("buildTermsHtml", () => {
  it("署名者名・組織名を escape する(XSS 防御)", () => {
    const html = buildTermsHtml({
      organizationName: "<script>alert(1)</script>",
      signerName: "a\"b'<c>",
      acceptedAt: "2026-08-19T02:30:00Z",
      ipAddress: null,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("同意日時を JST で表示(UTC 前日ズレを避ける)", () => {
    const html = buildTermsHtml({
      organizationName: "org",
      signerName: "x",
      acceptedAt: "2026-08-18T17:00:00Z", // = 2026-08-19 02:00 JST
      ipAddress: null,
    });
    expect(html).toContain("2026-08-19 02:00 (JST)");
  });

  it("禁止事項の箇条書き(bullets)が li として描画される", () => {
    const html = buildTermsHtml({
      organizationName: "org",
      signerName: "x",
      acceptedAt: null,
      ipAddress: null,
    });
    // 第3条(禁止事項)の bullet が li で出る
    expect(html).toContain("<li>法令または公序良俗に違反する行為</li>");
  });
});
