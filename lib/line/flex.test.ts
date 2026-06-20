import { describe, expect, it } from "vitest";

import { buildJobShareCard, buildJobShareCarousel } from "./flex";

describe("buildJobShareCard", () => {
  it("基本 求人 カード を Bubble で 返す", () => {
    const card = buildJobShareCard({
      jobId: "j1",
      position: "フロントエンドエンジニア",
      companyName: "株式会社サンプル",
      location: "東京",
      salaryText: "500-800 万円",
      heroImageUrl: null,
      detailUrl: "https://example.com/j1",
    });
    expect(card.type).toBe("flex");
    expect(card.altText).toContain("フロントエンドエンジニア");
    expect(card.contents.type).toBe("bubble");
  });

  it("heroImageUrl が あれば hero に セット", () => {
    const card = buildJobShareCard({
      jobId: "j1",
      position: "A",
      companyName: "B",
      location: null,
      salaryText: null,
      heroImageUrl: "https://example.com/h.jpg",
      detailUrl: "https://example.com",
    });
    const bubble = card.contents as { hero?: { url: string } };
    expect(bubble.hero?.url).toBe("https://example.com/h.jpg");
  });

  it("interestPostbackData が あれば 2 つ目 ボタン を 追加", () => {
    const card = buildJobShareCard({
      jobId: "j1",
      position: "A",
      companyName: "B",
      location: null,
      salaryText: null,
      heroImageUrl: null,
      detailUrl: "https://example.com",
      interestPostbackData: "job_interest:j1",
    });
    const bubble = card.contents as { footer: { contents: unknown[] } };
    expect(bubble.footer.contents.length).toBe(2);
  });
});

describe("buildJobShareCarousel", () => {
  it("1 件 なら Bubble を そのまま 返す", () => {
    const card = buildJobShareCarousel([
      {
        jobId: "j1",
        position: "A",
        companyName: "B",
        location: null,
        salaryText: null,
        heroImageUrl: null,
        detailUrl: "https://example.com",
      },
    ]);
    expect(card.contents.type).toBe("bubble");
  });

  it("複数 で carousel に なる", () => {
    const jobs = Array.from({ length: 3 }, (_, i) => ({
      jobId: `j${i}`,
      position: `Job ${i}`,
      companyName: "Co",
      location: null,
      salaryText: null,
      heroImageUrl: null,
      detailUrl: "https://example.com",
    }));
    const card = buildJobShareCarousel(jobs);
    expect(card.contents.type).toBe("carousel");
    if (card.contents.type === "carousel") {
      expect(card.contents.contents.length).toBe(3);
    }
  });

  it("13 件 渡したら 上限 12 件 で 切る", () => {
    const jobs = Array.from({ length: 13 }, (_, i) => ({
      jobId: `j${i}`,
      position: `Job ${i}`,
      companyName: "Co",
      location: null,
      salaryText: null,
      heroImageUrl: null,
      detailUrl: "https://example.com",
    }));
    const card = buildJobShareCarousel(jobs);
    if (card.contents.type === "carousel") {
      expect(card.contents.contents.length).toBe(12);
    }
  });

  it("0 件 で エラー", () => {
    expect(() => buildJobShareCarousel([])).toThrow();
  });
});
