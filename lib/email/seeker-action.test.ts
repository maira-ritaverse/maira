import { describe, expect, it } from "vitest";

import { buildHtmlBody } from "./seeker-action";

describe("buildHtmlBody", () => {
  const args = {
    organizationName: "○○エージェント",
    clientName: "山田太郎",
    jobLabel: "株式会社 X ・ PdM",
    actionLabel: "興味あり",
    href: "https://example.com/agency/clients/abc",
  };

  it("DOCTYPE と html タグを含む", () => {
    const html = buildHtmlBody(args);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="ja">');
  });

  it("主要フィールドを含む", () => {
    const html = buildHtmlBody(args);
    expect(html).toContain("山田太郎");
    expect(html).toContain("株式会社 X ・ PdM");
    expect(html).toContain("興味あり");
    expect(html).toContain(args.href);
  });

  it("HTML エスケープが効く(XSS 防止)", () => {
    const html = buildHtmlBody({
      ...args,
      clientName: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("href も escape される", () => {
    const html = buildHtmlBody({
      ...args,
      href: 'https://x.example/"><script>alert(1)</script>',
    });
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain("&quot;");
  });
});
