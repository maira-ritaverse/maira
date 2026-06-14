import { describe, it, expect } from "vitest";
import { DISCLOSURE_ITEMS, NOT_DISCLOSED_ITEMS } from "./disclosure-summary";

/**
 * 開示範囲の説明定数テスト。
 *
 * 「連携すると何が開示されるか」を本人に示すテキストは、承認ダイアログと
 * 連携中カードの「開示中の情報」リストの 2 箇所で同じ内容を出す単一情報源。
 * ここの内容が DisclosableProfile の実装(lib/connections/disclosable-profile)と
 * ズレると、UI 説明と実際の開示範囲に齟齬が出る重大な信頼問題になる。
 *
 * 文言の文字列マッチで固定し、不用意な変更を検知する。
 */

describe("DISCLOSURE_ITEMS(開示するもの)", () => {
  it("4 項目(履歴書 / 職務経歴書 / 希望条件 / プロフィール)", () => {
    expect(DISCLOSURE_ITEMS).toHaveLength(4);
  });

  it("履歴書 / 職務経歴書 を含む", () => {
    expect(DISCLOSURE_ITEMS).toContain("履歴書");
    expect(DISCLOSURE_ITEMS).toContain("職務経歴書");
  });

  it("希望条件は「希望業界・職種・会社規模」を明示(DisclosableProfile.wants と一致)", () => {
    const wantsItem = DISCLOSURE_ITEMS.find((i) => i.includes("希望条件"));
    expect(wantsItem).toBeDefined();
    expect(wantsItem).toContain("希望業界");
    expect(wantsItem).toContain("職種");
    expect(wantsItem).toContain("会社規模");
  });

  it("プロフィールは「現職・経験年数・業界」を明示(DisclosableProfile.user_facts と一致)", () => {
    const facts = DISCLOSURE_ITEMS.find((i) => i.includes("プロフィール"));
    expect(facts).toBeDefined();
    expect(facts).toContain("現職");
    expect(facts).toContain("経験年数");
    expect(facts).toContain("業界");
  });
});

describe("NOT_DISCLOSED_ITEMS(開示しないもの — 求職者の安心材料)", () => {
  it("2 項目(内面 / 診断結果)", () => {
    expect(NOT_DISCLOSED_ITEMS).toHaveLength(2);
  });

  it("内面(強み・価値観・懸念・人物総評)を明示", () => {
    const inner = NOT_DISCLOSED_ITEMS.find((i) => i.includes("内面"));
    expect(inner).toBeDefined();
    expect(inner).toContain("強み");
    expect(inner).toContain("価値観");
    expect(inner).toContain("懸念");
    expect(inner).toContain("人物総評");
  });

  it("キャリア診断結果も非開示として明示", () => {
    expect(NOT_DISCLOSED_ITEMS.some((i) => i.includes("キャリア診断"))).toBe(true);
  });
});

describe("DISCLOSURE_ITEMS と NOT_DISCLOSED_ITEMS の整合性", () => {
  it("各項目は非空", () => {
    for (const item of DISCLOSURE_ITEMS) expect(item.length).toBeGreaterThan(0);
    for (const item of NOT_DISCLOSED_ITEMS) expect(item.length).toBeGreaterThan(0);
  });

  it("開示と非開示で文字列の重複が無い(同じ項目が両方に載っていないこと)", () => {
    for (const open of DISCLOSURE_ITEMS) {
      for (const closed of NOT_DISCLOSED_ITEMS) {
        expect(open).not.toBe(closed);
      }
    }
  });
});
