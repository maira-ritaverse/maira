import { describe, expect, it } from "vitest";

import {
  agencyCvPayloadToSaveRequest,
  agencyResumePayloadToSaveRequest,
  parseYearMonth,
} from "./accept-mapper";

describe("parseYearMonth", () => {
  it("YYYY/MM・YYYY-M・YYYY・空・範囲外を正しく分解する", () => {
    expect(parseYearMonth("2020/03")).toEqual({ year: 2020, month: 3 });
    expect(parseYearMonth("2019-3")).toEqual({ year: 2019, month: 3 });
    expect(parseYearMonth("2021")).toEqual({ year: 2021, month: null });
    expect(parseYearMonth("")).toEqual({ year: null, month: null });
    expect(parseYearMonth("1800/13")).toEqual({ year: null, month: null });
  });
});

describe("agencyResumePayloadToSaveRequest", () => {
  it("項目名・gender・学歴 year・email・上限を求職者スキーマへ写す", () => {
    const req = agencyResumePayloadToSaveRequest(
      {
        data: {
          pii: {
            full_name: "山田 太郎",
            full_name_kana: "ヤマダ タロウ",
            birth_date: "1990-01-02",
            gender: "other",
            postal_code: "1500001",
            address: "東京都渋谷区",
            phone: "09012345678",
            email: "not-an-email",
            motivation: "志望動機です",
            self_pr: "自己PRです",
            preferences: "週4勤務希望",
          },
          education_history: [{ year: "2012/04", description: "○○大学 入学" }],
          licenses: [{ year: "2015", description: "普通自動車免許" }],
        },
      },
      "山田太郎さんの履歴書",
    );
    expect(req.name).toBe("山田 太郎");
    expect(req.name_kana).toBe("ヤマダ タロウ");
    expect(req.gender).toBe("unspecified"); // "other" → "unspecified"
    expect(req.email).toBe(""); // 不正メールは空に落とす
    expect(req.education_history[0]).toEqual({ year: 2012, month: 4, description: "○○大学 入学" });
    expect(req.licenses[0]).toEqual({ year: 2015, month: null, name: "普通自動車免許" });
    expect(req.motivation_note).toContain("志望動機です");
    expect(req.motivation_note).toContain("自己PRです");
    expect(req.personal_requests).toBe("週4勤務希望");
  });

  it("上限超過フィールドをクランプして saveResumeRequestSchema を通す", () => {
    const long = "あ".repeat(5000);
    const req = agencyResumePayloadToSaveRequest(
      { data: { pii: { full_name: "テスト", motivation: long, preferences: long } } },
      "",
    );
    expect(req.title).toBe("履歴書"); // 空 title は既定へ
    expect((req.motivation_note ?? "").length).toBeLessThanOrEqual(1000);
    expect((req.personal_requests ?? "").length).toBeLessThanOrEqual(1000);
  });

  it("有効なメールはそのまま通す", () => {
    const req = agencyResumePayloadToSaveRequest(
      { data: { pii: { full_name: "テスト", email: "a@example.com" } } },
      "t",
    );
    expect(req.email).toBe("a@example.com");
  });

  it("zod .email() を通らない誤入力メール(二重ドット/短TLD/IDN)は空にフォールバックし throw しない", () => {
    for (const bad of ["tanaka@gmail..com", "foo@bar.c", "foo@bar.123", "yamada@例え.jp"]) {
      const req = agencyResumePayloadToSaveRequest(
        { data: { pii: { full_name: "テスト", email: bad } } },
        "t",
      );
      expect(req.email).toBe("");
    }
  });
});

describe("agencyCvPayloadToSaveRequest", () => {
  it("summary/body を求職者 CV(構造化)へ best-effort で写す", () => {
    const req = agencyCvPayloadToSaveRequest(
      { data: { summary: "要約", body: "本文" } },
      "職務経歴書",
    );
    expect(req.body.summary).toBe("要約");
    expect(req.body.self_pr).toBe("本文");
    expect(req.body.work_experiences).toEqual([]);
    expect(req.body.skills).toEqual([]);
  });

  it("長い summary/body をクランプして saveCvRequestSchema を通す", () => {
    const long = "x".repeat(30000);
    const req = agencyCvPayloadToSaveRequest({ data: { summary: long, body: long } }, "");
    expect(req.title).toBe("職務経歴書");
    expect(req.body.summary.length).toBeLessThanOrEqual(1500);
    expect(req.body.self_pr.length).toBeLessThanOrEqual(2000);
  });
});
