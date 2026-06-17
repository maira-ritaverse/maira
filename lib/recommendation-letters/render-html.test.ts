import { describe, expect, it } from "vitest";

import {
  buildRecommendationLetterFilename,
  buildRecommendationLetterHtml,
  buildRecommendationLetterPlainText,
} from "./render-html";

const baseInput = {
  letter: {
    headline: "山田様(プロダクトマネージャー職)推薦の件",
    body: "拝啓 時下ますますご清祥のこととお慶び申し上げます。\n\n弊社が推薦する候補者は…",
    version: 2,
    status: "draft" as const,
  },
  template: {
    prefixBody: "拝啓 平素より大変お世話になっております。",
    suffixBody: "敬具\n○○エージェント株式会社",
  },
  organizationName: "○○エージェント株式会社",
  recipientCompanyName: "株式会社サンプル",
  recipientPosition: "プロダクトマネージャー",
  documentDate: "2026-06-17",
};

describe("buildRecommendationLetterHtml", () => {
  it("件名・本文・宛名・組織名がすべて HTML 内に含まれる", () => {
    const html = buildRecommendationLetterHtml(baseInput);
    expect(html).toContain("山田様(プロダクトマネージャー職)推薦の件");
    expect(html).toContain("時下ますますご清祥");
    expect(html).toContain("株式会社サンプル 採用ご担当者様");
    expect(html).toContain("○○エージェント株式会社");
  });

  it("テンプレ prefix と suffix が「本文の前後」に正しい順で含まれる", () => {
    const html = buildRecommendationLetterHtml(baseInput);
    const prefixIdx = html.indexOf("平素より大変お世話");
    const bodyIdx = html.indexOf("弊社が推薦する候補者");
    const suffixIdx = html.indexOf("敬具");
    expect(prefixIdx).toBeGreaterThan(0);
    expect(bodyIdx).toBeGreaterThan(prefixIdx);
    expect(suffixIdx).toBeGreaterThan(bodyIdx);
  });

  it("テンプレが null のときは prefix / suffix を出力しない", () => {
    const html = buildRecommendationLetterHtml({ ...baseInput, template: null });
    expect(html).not.toContain("平素より大変お世話");
    expect(html).not.toContain("敬具\n○○エージェント");
    // 本文だけは出る
    expect(html).toContain("時下ますますご清祥");
  });

  it("本文中の <script> 等は escapeHtml でエスケープされる(XSS 対策)", () => {
    const html = buildRecommendationLetterHtml({
      ...baseInput,
      letter: {
        ...baseInput.letter,
        body: "<script>alert(1)</script>本文の続き",
      },
    });
    // 生の <script> タグが残っていない
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    // 代わりにエスケープされた表現が入っている
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("本文の続き");
  });

  it("件名が空でも「(件名未設定)」プレースホルダで出力される(プレビュー時の見栄え)", () => {
    const html = buildRecommendationLetterHtml({
      ...baseInput,
      letter: { ...baseInput.letter, headline: "" },
    });
    expect(html).toContain("(件名未設定)");
  });

  it("発行日は「2026年6月17日」形式で出る", () => {
    const html = buildRecommendationLetterHtml(baseInput);
    expect(html).toContain("2026年6月17日");
  });

  it("不正な発行日フォーマットはそのまま出力(フェイルオープン)", () => {
    const html = buildRecommendationLetterHtml({
      ...baseInput,
      documentDate: "invalid-date",
    });
    expect(html).toContain("invalid-date");
  });

  it("ステータス(下書き / 確定済)とバージョンは提出書類に出さない", () => {
    // 提出する推薦文に「下書き v1」が印字されると体裁が悪いので、status / version は
    // どの状態でも HTML に含めない契約。
    const draftHtml = buildRecommendationLetterHtml({
      ...baseInput,
      letter: { ...baseInput.letter, status: "draft" },
    });
    expect(draftHtml).not.toContain("下書き");
    expect(draftHtml).not.toMatch(/v\d/);

    const finalHtml = buildRecommendationLetterHtml({
      ...baseInput,
      letter: { ...baseInput.letter, status: "finalized" },
    });
    expect(finalHtml).not.toContain("確定済");
    expect(finalHtml).not.toMatch(/v\d/);
  });

  it("Noto Serif JP の Web フォント link が含まれる(PDF 化で豆腐回避)", () => {
    const html = buildRecommendationLetterHtml(baseInput);
    expect(html).toContain("Noto+Serif+JP");
  });
});

describe("buildRecommendationLetterPlainText", () => {
  it("prefix → 本文 → suffix の順で連結される", () => {
    const text = buildRecommendationLetterPlainText({
      letter: { headline: "推薦の件", body: "本文です。" },
      template: {
        prefixBody: "PREFIX",
        suffixBody: "SUFFIX",
      },
      recipientCompanyName: "株式会社サンプル",
      organizationName: "弊エージェント",
      documentDate: "2026-06-17",
    });
    const prefixIdx = text.indexOf("PREFIX");
    const bodyIdx = text.indexOf("本文です。");
    const suffixIdx = text.indexOf("SUFFIX");
    expect(prefixIdx).toBeGreaterThan(0);
    expect(bodyIdx).toBeGreaterThan(prefixIdx);
    expect(suffixIdx).toBeGreaterThan(bodyIdx);
  });

  it("件名が空のときは「件名:」行を出さない(冗長表示を避ける)", () => {
    const text = buildRecommendationLetterPlainText({
      letter: { headline: "", body: "本文" },
      template: null,
      recipientCompanyName: "企業",
      organizationName: "弊社",
      documentDate: "2026-06-17",
    });
    expect(text).not.toContain("件名:");
  });
});

describe("buildRecommendationLetterFilename", () => {
  it("日本語名でも候補者・企業名がファイル名に入る", () => {
    const name = buildRecommendationLetterFilename({
      candidateName: "山田 太郎",
      companyName: "株式会社サンプル",
      version: 3,
    });
    expect(name).toContain("山田");
    expect(name).toContain("サンプル");
    expect(name).toMatch(/v3\.pdf$/);
  });

  it("スペースや特殊記号は _ に置き換わる(Content-Disposition 互換)", () => {
    const name = buildRecommendationLetterFilename({
      candidateName: "John Doe!",
      companyName: "ACME/Foo",
      version: 1,
    });
    expect(name).not.toContain(" ");
    expect(name).not.toContain("/");
    expect(name).not.toContain("!");
  });

  it("候補者名 / 企業名が空ならフォールバック名を使う", () => {
    const name = buildRecommendationLetterFilename({
      candidateName: "",
      companyName: "",
      version: 1,
    });
    expect(name).toContain("candidate");
    expect(name).toContain("company");
  });
});
