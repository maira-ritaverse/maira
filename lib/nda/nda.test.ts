import { describe, it, expect } from "vitest";

import { needsToAcceptNda } from "./nda";
import { CURRENT_NDA_VERSION } from "./nda-content";
import { buildNdaHtml } from "./nda-html";

describe("needsToAcceptNda", () => {
  it("未同意 → true", () => {
    expect(
      needsToAcceptNda({ acceptedAt: null, version: null, signerName: null, queryOk: true }),
    ).toBe(true);
  });

  it("旧バージョンに同意済 → true(再同意が必要)", () => {
    expect(
      needsToAcceptNda({
        acceptedAt: "2026-01-01T00:00:00Z",
        version: "2020-01-01",
        signerName: "山田",
        queryOk: true,
      }),
    ).toBe(true);
  });

  it("現行バージョンに同意済 → false", () => {
    expect(
      needsToAcceptNda({
        acceptedAt: "2026-01-01T00:00:00Z",
        version: CURRENT_NDA_VERSION,
        signerName: "山田",
        queryOk: true,
      }),
    ).toBe(false);
  });

  it("クエリ失敗(queryOk=false)→ false(fail-open でロックアウトを防ぐ)", () => {
    expect(
      needsToAcceptNda({ acceptedAt: null, version: null, signerName: null, queryOk: false }),
    ).toBe(false);
  });
});

describe("buildNdaHtml", () => {
  it("署名者名・組織名を escape する(XSS 防御)", () => {
    const html = buildNdaHtml({
      organizationName: "<script>alert(1)</script>",
      signerName: "a\"b'<c>",
      acceptedAt: "2026-08-19T02:30:00Z",
      version: CURRENT_NDA_VERSION,
      ipAddress: null,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("同意日時を JST で表示(UTC 前日ズレを避ける)", () => {
    const html = buildNdaHtml({
      organizationName: "org",
      signerName: "x",
      acceptedAt: "2026-08-18T17:00:00Z", // = 2026-08-19 02:00 JST
      version: CURRENT_NDA_VERSION,
      ipAddress: null,
    });
    expect(html).toContain("2026-08-19 02:00 (JST)");
  });
});
