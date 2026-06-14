import { describe, it, expect } from "vitest";
import {
  applyClientsFilterSort,
  buildEntrySiteOptions,
  normalizeEntrySiteKey,
  type ClientForFilterSort,
  type FilterSortOptions,
} from "./filter-sort";

/**
 * クライアント一覧の絞り込み・並び替え純関数のテスト。
 *
 * UI で触れる組み合わせ(検索 × ステータス × エントリーサイト × ソート列 × 方向)が
 * 多いため、各軸を独立してテストしつつ、組合せで意外な相互作用が無いかも確認。
 *
 * fixture は最小限。実 ClientRecord の他フィールドは使わないことを表すための
 * Pick 派生型(ClientForFilterSort)で受けている。
 */

// テスト fixture を簡潔に作るヘルパー(必要なフィールドだけ受け取る)
function client(
  name: string,
  email: string,
  status: ClientForFilterSort["status"],
  createdAt: string,
  entrySite: string | null = null,
): ClientForFilterSort {
  return { name, email, status, createdAt, entrySite };
}

const baseOpts: FilterSortOptions = {
  searchQuery: "",
  statusFilter: "all",
  entrySiteFilter: "all",
  sortColumn: "createdAt",
  sortDirection: "desc",
};

describe("normalizeEntrySiteKey", () => {
  it("null / undefined / 空文字 / 空白のみ は 'unset' に正規化", () => {
    expect(normalizeEntrySiteKey(null)).toBe("unset");
    expect(normalizeEntrySiteKey(undefined)).toBe("unset");
    expect(normalizeEntrySiteKey("")).toBe("unset");
    expect(normalizeEntrySiteKey("   ")).toBe("unset");
    expect(normalizeEntrySiteKey("\t\n")).toBe("unset");
  });

  it("非空の文字列はそのまま返す(トリムしない)", () => {
    expect(normalizeEntrySiteKey("リクナビ")).toBe("リクナビ");
    expect(normalizeEntrySiteKey(" リクナビ ")).toBe(" リクナビ "); // 前後空白は保つ
  });
});

describe("applyClientsFilterSort — 検索", () => {
  const fixtures = [
    client("田中太郎", "tanaka@example.com", "job_matching", "2026-06-01"),
    client("佐藤花子", "sato@example.com", "job_matching", "2026-06-02"),
    client("鈴木一郎", "suzuki@gmail.com", "job_matching", "2026-06-03"),
  ];

  it("空クエリは全件返す", () => {
    expect(applyClientsFilterSort(fixtures, baseOpts)).toHaveLength(3);
  });

  it("名前部分一致(大文字小文字無視)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "田中" });
    expect(r.map((c) => c.name)).toEqual(["田中太郎"]);
  });

  it("メール部分一致(ドメインで絞れる)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "@gmail" });
    expect(r.map((c) => c.name)).toEqual(["鈴木一郎"]);
  });

  it("大文字メールも小文字クエリでヒット", () => {
    const upper = [client("X", "ME@EXAMPLE.COM", "job_matching", "2026-06-01")];
    expect(applyClientsFilterSort(upper, { ...baseOpts, searchQuery: "me@" })).toHaveLength(1);
  });

  it("前後空白だけのクエリは空クエリと同じ扱い(trim)", () => {
    expect(applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "   " })).toHaveLength(3);
  });
});

describe("applyClientsFilterSort — ステータス絞り込み", () => {
  const fixtures = [
    client("A", "a@x", "job_matching", "2026-06-01"),
    client("B", "b@x", "completed", "2026-06-02"),
    client("C", "c@x", "completed", "2026-06-03"),
  ];

  it("'all' は絞らない", () => {
    expect(applyClientsFilterSort(fixtures, { ...baseOpts, statusFilter: "all" })).toHaveLength(3);
  });

  it("特定 status だけ抽出", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, statusFilter: "completed" });
    expect(r.map((c) => c.name)).toEqual(["C", "B"]); // createdAt desc
  });
});

describe("applyClientsFilterSort — エントリーサイト絞り込み", () => {
  const fixtures = [
    client("A", "a@x", "job_matching", "2026-06-01", "リクナビ"),
    client("B", "b@x", "job_matching", "2026-06-02", "doda"),
    client("C", "c@x", "job_matching", "2026-06-03", null),
    client("D", "d@x", "job_matching", "2026-06-04", ""),
    client("E", "e@x", "job_matching", "2026-06-05", "   "),
  ];

  it("'all' は絞らない", () => {
    expect(applyClientsFilterSort(fixtures, { ...baseOpts, entrySiteFilter: "all" })).toHaveLength(
      5,
    );
  });

  it("特定の媒体名で絞る", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, entrySiteFilter: "リクナビ" });
    expect(r.map((c) => c.name)).toEqual(["A"]);
  });

  it("'unset' は null / 空 / 空白を全部拾う", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, entrySiteFilter: "unset" });
    expect(r.map((c) => c.name).sort()).toEqual(["C", "D", "E"]);
  });
});

describe("applyClientsFilterSort — ソート", () => {
  const fixtures = [
    client("田中", "t@x", "job_matching", "2026-06-03"),
    client("佐藤", "s@x", "completed", "2026-06-01"),
    client("鈴木", "k@x", "job_matching", "2026-06-02"),
  ];

  it("createdAt asc(古い順)", () => {
    const r = applyClientsFilterSort(fixtures, {
      ...baseOpts,
      sortColumn: "createdAt",
      sortDirection: "asc",
    });
    expect(r.map((c) => c.createdAt)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("createdAt desc(新しい順、default)", () => {
    const r = applyClientsFilterSort(fixtures, baseOpts);
    expect(r.map((c) => c.createdAt)).toEqual(["2026-06-03", "2026-06-02", "2026-06-01"]);
  });

  it("name 'ja' ロケールで自然順(漢字も比較可能、結果は ja の規約に従う)", () => {
    const r = applyClientsFilterSort(fixtures, {
      ...baseOpts,
      sortColumn: "name",
      sortDirection: "asc",
    });
    // localeCompare("ja") の安定挙動だけ保証(全 3 名が含まれる + 順序が決定的)
    expect(r).toHaveLength(3);
    const names = r.map((c) => c.name);
    // 順序を逆にすると別配列になることだけ確認(安定して同じ結果が返る)
    const desc = applyClientsFilterSort(fixtures, {
      ...baseOpts,
      sortColumn: "name",
      sortDirection: "desc",
    }).map((c) => c.name);
    expect(desc).toEqual(names.slice().reverse());
  });

  it("元配列を破壊しない(in-place sort しない)", () => {
    const original = fixtures.slice();
    applyClientsFilterSort(fixtures, { ...baseOpts, sortColumn: "name", sortDirection: "asc" });
    expect(fixtures).toEqual(original);
  });
});

describe("applyClientsFilterSort — 複合", () => {
  const fixtures = [
    client("田中", "t@gmail.com", "job_matching", "2026-06-01", "リクナビ"),
    client("田原", "tahara@gmail.com", "completed", "2026-06-02", "リクナビ"),
    client("佐藤", "s@yahoo.co.jp", "job_matching", "2026-06-03", "doda"),
  ];

  it("検索 + ステータス + エントリーサイトを同時に AND 適用", () => {
    const r = applyClientsFilterSort(fixtures, {
      ...baseOpts,
      searchQuery: "田",
      statusFilter: "job_matching",
      entrySiteFilter: "リクナビ",
    });
    expect(r.map((c) => c.name)).toEqual(["田中"]);
  });

  it("該当無しなら空配列", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "存在しない" });
    expect(r).toEqual([]);
  });
});

describe("buildEntrySiteOptions", () => {
  const fixtures = [
    client("A", "a@x", "job_matching", "2026-06-01", "リクナビ"),
    client("B", "b@x", "job_matching", "2026-06-02", "リクナビ"),
    client("C", "c@x", "job_matching", "2026-06-03", "リクナビ"),
    client("D", "d@x", "job_matching", "2026-06-04", "doda"),
    client("E", "e@x", "job_matching", "2026-06-05", null),
  ];

  it("件数降順で並ぶ(リクナビ 3 > doda 1 = unset 1)", () => {
    const r = buildEntrySiteOptions(fixtures);
    expect(r[0]).toEqual(["リクナビ", 3]);
    // 2 番目以降は doda と unset の順序は仕様未定(同数)
    expect(
      r
        .slice(1)
        .map(([k]) => k)
        .sort(),
    ).toEqual(["doda", "unset"]);
  });

  it("空配列なら空配列", () => {
    expect(buildEntrySiteOptions([])).toEqual([]);
  });

  it("entrySite が全て null なら ['unset', N] 1 件のみ", () => {
    const onlyNull = [
      client("A", "a@x", "job_matching", "2026-06-01", null),
      client("B", "b@x", "job_matching", "2026-06-02", null),
    ];
    expect(buildEntrySiteOptions(onlyNull)).toEqual([["unset", 2]]);
  });
});
