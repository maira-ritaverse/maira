import { describe, expect, it } from "vitest";

import {
  hashQuery,
  normalizeQuery,
  sanitizeClientFilters,
  buildJobsPrompt,
  buildClientsPrompt,
} from "./nl-parse";
import type { ClientSearchFilters } from "./nl-parse-schema";

describe("normalizeQuery", () => {
  it("NFKC + toLowerCase + 空白圧縮を掛ける", () => {
    // 全角スペース + 全角数字 + 大文字 → NFKC で半角/小文字化、連続空白を単一に
    expect(normalizeQuery("  Webエンジニア  年収500万")).toBe("webエンジニア 年収500万");
    expect(normalizeQuery("東京都　　リモート")).toBe("東京都 リモート");
  });

  it("同意味クエリは同じ正規化結果になる (キャッシュヒット率を上げる目的)", () => {
    expect(normalizeQuery("東京 リモート")).toBe(normalizeQuery("東京  リモート"));
    expect(normalizeQuery("Web ENGINEER")).toBe(normalizeQuery("web engineer"));
  });
});

describe("hashQuery", () => {
  it("同一入力に対して決定論的で 32 文字の hex を返す", () => {
    const h1 = hashQuery("東京 リモート");
    const h2 = hashQuery("東京 リモート");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(32);
    expect(h1).toMatch(/^[a-f0-9]+$/u);
  });

  it("異なる入力は異なるハッシュ", () => {
    expect(hashQuery("東京")).not.toBe(hashQuery("大阪"));
  });
});

describe("sanitizeClientFilters", () => {
  const baseFilters: ClientSearchFilters = {
    searchQuery: "",
    statusFilter: "all",
    entrySiteFilter: "all",
    prefectureFilter: "all",
    employmentTypeFilter: "all",
    silenceFilter: "all",
    tagFilter: [],
    remainingText: "",
    confidence: "high",
  };
  const vocab = {
    entrySites: ["リクナビ", "マイナビ"],
    prefectures: ["東京都", "神奈川県"],
    crmTags: ["急ぎ", "英語可"],
  };

  it("実在する値はそのまま残す", () => {
    const result = sanitizeClientFilters(
      { ...baseFilters, prefectureFilter: "東京都", tagFilter: ["急ぎ"] },
      vocab,
    );
    expect(result.prefectureFilter).toBe("東京都");
    expect(result.tagFilter).toEqual(["急ぎ"]);
    expect(result.confidence).toBe("high");
  });

  it("実在しない都道府県は 'all' に落として remainingText に流し confidence を low にする", () => {
    const result = sanitizeClientFilters({ ...baseFilters, prefectureFilter: "北海道" }, vocab);
    expect(result.prefectureFilter).toBe("all");
    expect(result.remainingText).toContain("北海道");
    expect(result.confidence).toBe("low");
  });

  it("実在しないタグは無視し confidence を low にする", () => {
    const result = sanitizeClientFilters(
      { ...baseFilters, tagFilter: ["急ぎ", "不存在タグ"] },
      vocab,
    );
    expect(result.tagFilter).toEqual(["急ぎ"]);
    expect(result.confidence).toBe("low");
  });

  it("特殊値 'unset' はそのまま許可する (実在チェック対象外)", () => {
    const result = sanitizeClientFilters({ ...baseFilters, entrySiteFilter: "unset" }, vocab);
    expect(result.entrySiteFilter).toBe("unset");
  });
});

describe("buildJobsPrompt", () => {
  it("system メッセージに主要ルールと語彙を含める", () => {
    const { system, prompt } = buildJobsPrompt("年収 500 万以上のリモート Web", {
      locations: ["東京", "リモート"],
      companyNames: ["ACME", "BETA"],
      employmentTypes: ["正社員", "業務委託"],
    });
    // ルール
    expect(system).toContain("万円単位の整数");
    expect(system).toContain("勝手に募集中で絞らない");
    expect(system).toContain("リモート");
    // 語彙
    expect(system).toContain("勤務地: 東京, リモート");
    expect(system).toContain("雇用形態: 正社員, 業務委託");
    // プロンプト
    expect(prompt).toContain("年収 500 万以上のリモート Web");
  });
});

describe("buildClientsPrompt", () => {
  it("system メッセージに status / silence の辞書と語彙を含める", () => {
    const { system, prompt } = buildClientsPrompt("東京 面接待ち", {
      entrySites: ["リクナビ"],
      prefectures: ["東京都"],
      crmTags: ["急ぎ"],
    });
    expect(system).toContain("in_screening=選考中");
    expect(system).toContain("silenceFilter");
    expect(system).toContain("都道府県: 東京都");
    expect(system).toContain("CRM タグ: 急ぎ");
    expect(prompt).toContain("東京 面接待ち");
  });
});
