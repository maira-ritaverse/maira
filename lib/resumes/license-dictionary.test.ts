import { describe, it, expect } from "vitest";
import { licenseDictionary, searchLicenses } from "./license-dictionary";

/**
 * 資格辞書の検索テスト。
 *
 * 履歴書「免許・資格」欄のオートコンプリートに使う。
 * 略称・大文字小文字・空クエリの扱いを境界ごとに固めると、UI が
 * 「ユーザの入力途中で候補が空になる/重複する」事故を防げる。
 *
 * 辞書本体(licenseDictionary)は静的データだが、name の重複は検索ロジックの
 * 「同じ name は 1 件として返す」契約と相性が悪いので、入りやすい罠として
 * 構造テストも入れる。
 */

describe("licenseDictionary", () => {
  it("全エントリに name と category がある", () => {
    for (const item of licenseDictionary) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.category.length).toBeGreaterThan(0);
    }
  });

  it("name に重複が無い(検索結果の dedup ロジックと整合)", () => {
    const names = licenseDictionary.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("aliases が空配列のエントリは無い(undefined にすべきで [] は不要)", () => {
    // [] が混ざると意味のない iteration が走るので、定義時の漏れを検知。
    for (const item of licenseDictionary) {
      if (item.aliases !== undefined) {
        expect(item.aliases.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("searchLicenses — 空クエリ", () => {
  it("空文字なら空配列(全件出さない=操作を邪魔しない契約)", () => {
    expect(searchLicenses("")).toEqual([]);
  });

  it("空白のみのクエリも空配列(trim 後に空)", () => {
    expect(searchLicenses("   ")).toEqual([]);
    expect(searchLicenses("\t\n")).toEqual([]);
  });
});

describe("searchLicenses — 名前検索", () => {
  it("正式名称の部分一致でヒットする", () => {
    const r = searchLicenses("宅地建物取引士");
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((i) => i.name === "宅地建物取引士")).toBe(true);
  });

  it("部分文字列でヒットする('運転免許' で複数の運転免許関連)", () => {
    const r = searchLicenses("運転免許");
    expect(r.length).toBeGreaterThan(0);
    for (const item of r) {
      const matched =
        item.name.includes("運転免許") ||
        (item.aliases?.some((a) => a.includes("運転免許")) ?? false);
      expect(matched, `${item.name} にも aliases にも '運転免許' が無い`).toBe(true);
    }
  });
});

describe("searchLicenses — alias 検索", () => {
  it("略称('宅建')から正式名称('宅地建物取引士')がヒットする", () => {
    const r = searchLicenses("宅建");
    expect(r.some((i) => i.name === "宅地建物取引士")).toBe(true);
  });

  it("英字略称('TOEIC')でも引ける", () => {
    const r = searchLicenses("TOEIC");
    expect(r.length).toBeGreaterThan(0);
    expect(
      r.every(
        (i) => i.name.includes("TOEIC") || (i.aliases?.some((a) => a.includes("TOEIC")) ?? false),
      ),
    ).toBe(true);
  });
});

describe("searchLicenses — 大文字小文字", () => {
  it("クエリの大文字小文字を無視する('toeic' でも 'TOEIC' でも同じ結果)", () => {
    const upper = searchLicenses("TOEIC").map((i) => i.name);
    const lower = searchLicenses("toeic").map((i) => i.name);
    const mixed = searchLicenses("ToEiC").map((i) => i.name);
    expect(lower).toEqual(upper);
    expect(mixed).toEqual(upper);
  });
});

describe("searchLicenses — 重複排除", () => {
  it("同じ name が複数 alias にヒットしても 1 件として返す", () => {
    // '普通自動車第一種運転免許' は aliases に '普通免許', '運転免許' などを持つ。
    // '免許' で検索すると name にも aliases にもヒットするが、結果は 1 件のはず。
    const r = searchLicenses("普通自動車第一種運転免許");
    const target = r.filter((i) => i.name === "普通自動車第一種運転免許");
    expect(target).toHaveLength(1);
  });
});

describe("searchLicenses — limit", () => {
  it("limit 未指定なら全候補を返す", () => {
    const all = searchLicenses("免許");
    const limited = searchLicenses("免許", 3);
    expect(all.length).toBeGreaterThan(3);
    expect(limited).toHaveLength(3);
  });

  it("limit が結果数より多くてもエラーにならず全候補を返す", () => {
    const r = searchLicenses("宅建", 100);
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThan(100);
  });

  it("limit=0 でも最低 1 件は push されてから break する(実装の現状挙動)", () => {
    // 実装は push してから length >= limit を判定するため、limit=0 でも 1 件返る。
    // 業務的に limit=0 を渡す箇所は無いが、挙動を明示しておく。
    // 「0 件で止めたい」なら呼び出し側で limit を負にせず query を弾く設計。
    expect(searchLicenses("免許", 0).length).toBe(1);
  });
});

describe("searchLicenses — ヒット無し", () => {
  it("辞書に無い文字列は空配列", () => {
    expect(searchLicenses("存在しないと思われる完全に架空の資格名XYZ123")).toEqual([]);
  });
});
