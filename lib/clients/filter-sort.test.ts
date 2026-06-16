import { describe, it, expect } from "vitest";
import {
  applyClientsFilterSort,
  buildCrmTagOptions,
  buildEmploymentTypeOptions,
  buildEntrySiteOptions,
  buildPrefectureOptions,
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

// テスト fixture を簡潔に作るヘルパー(必要なフィールドだけ受け取る)。
// EMPRO 拡張(nameKana / prefecture / currentEmploymentType)は任意引数で、
// 既存テストは未指定で null フォールバック → 旧テスト破壊なし。
function client(
  name: string,
  email: string,
  status: ClientForFilterSort["status"],
  createdAt: string,
  entrySite: string | null = null,
  extras: Partial<
    Pick<
      ClientForFilterSort,
      "nameKana" | "prefecture" | "currentEmploymentType" | "lastInteractionAt" | "crmTags"
    >
  > = {},
): ClientForFilterSort {
  return {
    name,
    email,
    status,
    createdAt,
    entrySite,
    nameKana: extras.nameKana ?? null,
    prefecture: extras.prefecture ?? null,
    currentEmploymentType: extras.currentEmploymentType ?? null,
    lastInteractionAt: extras.lastInteractionAt ?? null,
    crmTags: extras.crmTags ?? [],
  };
}

const baseOpts: FilterSortOptions = {
  searchQuery: "",
  statusFilter: "all",
  entrySiteFilter: "all",
  prefectureFilter: "all",
  employmentTypeFilter: "all",
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

// ====================================================================
// EMPRO 拡張(マイグレーション 20260615100001)で追加された 3 軸
// ====================================================================

describe("applyClientsFilterSort — 氏名カナ検索", () => {
  const fixtures = [
    client("田中太郎", "tanaka@x", "job_matching", "2026-06-01", null, {
      nameKana: "タナカ タロウ",
    }),
    client("佐藤花子", "sato@x", "job_matching", "2026-06-02", null, {
      nameKana: "サトウ ハナコ",
    }),
    client("Smith John", "smith@x", "job_matching", "2026-06-03", null, {
      nameKana: null, // カナ未入力
    }),
  ];

  it("カナで部分一致検索できる", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "タナカ" });
    expect(r.map((c) => c.name)).toEqual(["田中太郎"]);
  });

  it("カナで姓のみでもヒット", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "サトウ" });
    expect(r.map((c) => c.name)).toEqual(["佐藤花子"]);
  });

  it("カナが null のレコードは name/email でだけヒット可能", () => {
    expect(
      applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "Smith" }).map((c) => c.name),
    ).toEqual(["Smith John"]);
    // カナで検索しても null のレコードは出ない(当然)
    expect(
      applyClientsFilterSort(fixtures, { ...baseOpts, searchQuery: "スミス" }).map((c) => c.name),
    ).toEqual([]);
  });
});

describe("applyClientsFilterSort — 都道府県絞り込み", () => {
  const fixtures = [
    client("A", "a@x", "job_matching", "2026-06-01", null, { prefecture: "東京都" }),
    client("B", "b@x", "job_matching", "2026-06-02", null, { prefecture: "東京都" }),
    client("C", "c@x", "job_matching", "2026-06-03", null, { prefecture: "大阪府" }),
    client("D", "d@x", "job_matching", "2026-06-04", null, { prefecture: null }),
  ];

  it("'all' は絞らない", () => {
    expect(applyClientsFilterSort(fixtures, { ...baseOpts, prefectureFilter: "all" })).toHaveLength(
      4,
    );
  });

  it("特定の都道府県で絞る", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, prefectureFilter: "東京都" });
    expect(r.map((c) => c.name).sort()).toEqual(["A", "B"]);
  });

  it("'unset' は null/空/空白を全部拾う", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, prefectureFilter: "unset" });
    expect(r.map((c) => c.name)).toEqual(["D"]);
  });
});

describe("applyClientsFilterSort — 雇用形態絞り込み", () => {
  const fixtures = [
    client("A", "a@x", "job_matching", "2026-06-01", null, { currentEmploymentType: "full_time" }),
    client("B", "b@x", "job_matching", "2026-06-02", null, { currentEmploymentType: "full_time" }),
    client("C", "c@x", "job_matching", "2026-06-03", null, { currentEmploymentType: "contract" }),
    client("D", "d@x", "job_matching", "2026-06-04", null, { currentEmploymentType: null }),
  ];

  it("'all' は絞らない", () => {
    expect(
      applyClientsFilterSort(fixtures, { ...baseOpts, employmentTypeFilter: "all" }),
    ).toHaveLength(4);
  });

  it("enum 値で絞る(full_time)", () => {
    const r = applyClientsFilterSort(fixtures, {
      ...baseOpts,
      employmentTypeFilter: "full_time",
    });
    expect(r.map((c) => c.name).sort()).toEqual(["A", "B"]);
  });

  it("'unset' は currentEmploymentType=null を拾う", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, employmentTypeFilter: "unset" });
    expect(r.map((c) => c.name)).toEqual(["D"]);
  });
});

describe("applyClientsFilterSort — EMPRO フィルタの AND 適用", () => {
  it("都道府県 + 雇用形態 + ステータス が AND で適用される", () => {
    const fixtures = [
      client("A", "a@x", "job_matching", "2026-06-01", null, {
        prefecture: "東京都",
        currentEmploymentType: "full_time",
      }),
      client("B", "b@x", "completed", "2026-06-02", null, {
        prefecture: "東京都",
        currentEmploymentType: "full_time",
      }),
      client("C", "c@x", "job_matching", "2026-06-03", null, {
        prefecture: "大阪府",
        currentEmploymentType: "full_time",
      }),
    ];
    const r = applyClientsFilterSort(fixtures, {
      ...baseOpts,
      prefectureFilter: "東京都",
      employmentTypeFilter: "full_time",
      statusFilter: "job_matching",
    });
    expect(r.map((c) => c.name)).toEqual(["A"]);
  });
});

describe("buildPrefectureOptions / buildEmploymentTypeOptions", () => {
  const fixtures = [
    client("A", "a@x", "job_matching", "2026-06-01", null, {
      prefecture: "東京都",
      currentEmploymentType: "full_time",
    }),
    client("B", "b@x", "job_matching", "2026-06-02", null, {
      prefecture: "東京都",
      currentEmploymentType: "contract",
    }),
    client("C", "c@x", "job_matching", "2026-06-03", null, {
      prefecture: null,
      currentEmploymentType: null,
    }),
  ];

  it("都道府県オプション:件数降順", () => {
    const r = buildPrefectureOptions(fixtures);
    expect(r[0]).toEqual(["東京都", 2]);
    expect(r.find(([k]) => k === "unset")).toEqual(["unset", 1]);
  });

  it("雇用形態オプション:enum 値 + 件数", () => {
    const r = buildEmploymentTypeOptions(fixtures);
    const keys = r.map(([k]) => k).sort();
    expect(keys).toEqual(["contract", "full_time", "unset"]);
  });

  it("空配列なら空配列(両関数)", () => {
    expect(buildPrefectureOptions([])).toEqual([]);
    expect(buildEmploymentTypeOptions([])).toEqual([]);
  });
});

// ────────────────────────────────────────────
// silenceFilter(沈黙顧客アラート、CRM 機能)
// ────────────────────────────────────────────
describe("applyClientsFilterSort — silenceFilter(沈黙顧客)", () => {
  // 基準現在時刻:2026-06-15 00:00:00 UTC
  const now = Date.parse("2026-06-15T00:00:00.000Z");

  // fixture:
  //   silent60 -- 最終対応 65 日前(→ 14d / 30d / 60d で残る、90d で消える)
  //   silent30 -- 最終対応 31 日前(→ 14d / 30d で残る、60d / 90d で消える)
  //   recent  -- 最終対応 5 日前(→ どの閾値でも消える)
  //   never_old -- 対応無し、作成 100 日前(→ 14d / 30d / 60d / 90d で残る、never で残る)
  //   never_new -- 対応無し、作成 3 日前(→ 14d 以上では消える、never で残る)
  const fixtures = [
    client("silent60", "s60@x.com", "job_matching", "2026-06-14", null, {
      lastInteractionAt: "2026-04-11T00:00:00.000Z", // 65 日前
    }),
    client("silent30", "s30@x.com", "job_matching", "2026-06-14", null, {
      lastInteractionAt: "2026-05-15T00:00:00.000Z", // 31 日前
    }),
    client("recent", "r@x.com", "job_matching", "2026-06-14", null, {
      lastInteractionAt: "2026-06-10T00:00:00.000Z", // 5 日前
    }),
    client("never_old", "no@x.com", "job_matching", "2026-03-07", null, {
      lastInteractionAt: null, // 対応無し、作成 100 日前
    }),
    client("never_new", "nn@x.com", "job_matching", "2026-06-12", null, {
      lastInteractionAt: null, // 対応無し、作成 3 日前
    }),
  ];

  it("'all' は絞らない", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, silenceFilter: "all", now });
    expect(r).toHaveLength(5);
  });

  it("silenceFilter を渡さない場合も全件返す(後方互換)", () => {
    expect(applyClientsFilterSort(fixtures, baseOpts)).toHaveLength(5);
  });

  it("'14d' は 14 日以上経過(対応無しは createdAt を起点)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, silenceFilter: "14d", now });
    const names = r.map((c) => c.name).sort();
    // silent60, silent30, never_old(100 日前作成)が残る
    expect(names).toEqual(["never_old", "silent30", "silent60"]);
  });

  it("'30d' は 30 日以上経過", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, silenceFilter: "30d", now });
    const names = r.map((c) => c.name).sort();
    expect(names).toEqual(["never_old", "silent30", "silent60"]);
  });

  it("'60d' は 60 日以上経過(silent30 は消える)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, silenceFilter: "60d", now });
    const names = r.map((c) => c.name).sort();
    expect(names).toEqual(["never_old", "silent60"]);
  });

  it("'90d' は 90 日以上経過(silent60 も消え、never_old だけ残る)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, silenceFilter: "90d", now });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("never_old");
  });

  it("'never' は lastInteractionAt が null のレコードのみ", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, silenceFilter: "never", now });
    const names = r.map((c) => c.name).sort();
    expect(names).toEqual(["never_new", "never_old"]);
  });

  it("now が未指定でも落ちず素通り(silenceFilter の判定はスキップ)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, silenceFilter: "30d" });
    expect(r).toHaveLength(5);
  });

  it("不正な日付文字列は除外(Date.parse が NaN を返すケース)", () => {
    const broken = client("broken", "b@x.com", "job_matching", "not-a-date", null, {
      lastInteractionAt: "also-not-a-date",
    });
    const r = applyClientsFilterSort([broken], { ...baseOpts, silenceFilter: "30d", now });
    expect(r).toHaveLength(0);
  });

  it("他のフィルタと組み合わせ:silenceFilter + statusFilter", () => {
    const mixed = [
      ...fixtures,
      client("silent_completed", "sc@x.com", "completed", "2026-06-14", null, {
        lastInteractionAt: "2026-04-11T00:00:00.000Z",
      }),
    ];
    const r = applyClientsFilterSort(mixed, {
      ...baseOpts,
      silenceFilter: "30d",
      statusFilter: "completed",
      now,
    });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("silent_completed");
  });
});

// ────────────────────────────────────────────
// CRM 自由タグフィルタ
// ────────────────────────────────────────────
describe("applyClientsFilterSort — tagFilter(CRM 自由タグ)", () => {
  const fixtures = [
    client("a", "a@x.com", "job_matching", "2026-06-14", null, { crmTags: ["VIP", "上場志望"] }),
    client("b", "b@x.com", "job_matching", "2026-06-14", null, { crmTags: ["要フォロー"] }),
    client("c", "c@x.com", "job_matching", "2026-06-14", null, { crmTags: ["VIP", "要フォロー"] }),
    client("d", "d@x.com", "job_matching", "2026-06-14", null, { crmTags: [] }),
  ];

  it("tagFilter 未指定 / 空配列は絞らない", () => {
    expect(applyClientsFilterSort(fixtures, baseOpts)).toHaveLength(4);
    expect(applyClientsFilterSort(fixtures, { ...baseOpts, tagFilter: [] })).toHaveLength(4);
  });

  it("単一タグでの絞り込み(VIP を持つもの)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, tagFilter: ["VIP"] });
    expect(r.map((c) => c.name).sort()).toEqual(["a", "c"]);
  });

  it("複数タグは AND 条件(VIP + 要フォロー 両方を持つもの)", () => {
    const r = applyClientsFilterSort(fixtures, { ...baseOpts, tagFilter: ["VIP", "要フォロー"] });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("c");
  });

  it("存在しないタグでは 0 件", () => {
    expect(
      applyClientsFilterSort(fixtures, { ...baseOpts, tagFilter: ["存在しない"] }),
    ).toHaveLength(0);
  });
});

describe("buildCrmTagOptions", () => {
  it("空入力は空配列", () => {
    expect(buildCrmTagOptions([])).toEqual([]);
  });

  it("件数降順で並ぶ", () => {
    const fixtures = [
      client("a", "a@x.com", "job_matching", "2026-06-14", null, { crmTags: ["VIP"] }),
      client("b", "b@x.com", "job_matching", "2026-06-14", null, { crmTags: ["VIP", "上場志望"] }),
      client("c", "c@x.com", "job_matching", "2026-06-14", null, {
        crmTags: ["VIP", "要フォロー"],
      }),
    ];
    const r = buildCrmTagOptions(fixtures);
    expect(r[0]).toEqual(["VIP", 3]);
    const restKeys = r
      .slice(1)
      .map(([k]) => k)
      .sort();
    expect(restKeys).toEqual(["上場志望", "要フォロー"]);
  });

  it("空文字タグは無視", () => {
    const fixtures = [
      client("a", "a@x.com", "job_matching", "2026-06-14", null, { crmTags: ["", "VIP"] }),
    ];
    expect(buildCrmTagOptions(fixtures)).toEqual([["VIP", 1]]);
  });
});
