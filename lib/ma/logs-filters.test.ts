import { describe, it, expect } from "vitest";
import { buildLogsUrl, parseLogDateRange, parseLogPage, parseLogStatus } from "./logs-filters";

/**
 * URL クエリ解釈の境界テスト。
 *
 * UI(Server Component)と CSV エクスポート API の両方が同じ関数を呼ぶので、
 * ここのテストが両方の境界挙動を担保する。
 * 「URL を直接いじられても安全に倒す」が本質なので、不正値ケースを重点的に検証。
 */

describe("parseLogStatus", () => {
  it("有効なステータスはそのまま返す", () => {
    expect(parseLogStatus("sent")).toBe("sent");
    expect(parseLogStatus("failed")).toBe("failed");
    expect(parseLogStatus("skipped")).toBe("skipped");
  });

  it("undefined / null / 空文字は undefined(全ステータス対象)", () => {
    expect(parseLogStatus(undefined)).toBeUndefined();
    expect(parseLogStatus(null)).toBeUndefined();
    expect(parseLogStatus("")).toBeUndefined();
  });

  it("想定外の値は undefined(URL 直打ち対策)", () => {
    expect(parseLogStatus("SENT")).toBeUndefined(); // 大文字違い
    expect(parseLogStatus("queued")).toBeUndefined(); // 存在しない status
    expect(parseLogStatus("sent ")).toBeUndefined(); // 末尾空白
    expect(parseLogStatus("' OR 1=1")).toBeUndefined(); // SQL ぽい文字列も無効化
  });
});

describe("parseLogDateRange", () => {
  it("両方有効な日付は ISO 8601 に時刻補完する", () => {
    expect(parseLogDateRange("2026-06-01", "2026-06-14")).toEqual({
      dateFrom: "2026-06-01T00:00:00.000Z",
      dateTo: "2026-06-14T23:59:59.999Z",
    });
  });

  it("from だけ・to だけ片側指定もそれぞれ補完する", () => {
    expect(parseLogDateRange("2026-06-01", undefined)).toEqual({
      dateFrom: "2026-06-01T00:00:00.000Z",
      dateTo: undefined,
    });
    expect(parseLogDateRange(undefined, "2026-06-14")).toEqual({
      dateFrom: undefined,
      dateTo: "2026-06-14T23:59:59.999Z",
    });
  });

  it("両方未指定なら両方 undefined(全期間対象)", () => {
    expect(parseLogDateRange(undefined, undefined)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(parseLogDateRange(null, null)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(parseLogDateRange("", "")).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it("YYYY-MM-DD 形式でないものは undefined に倒す", () => {
    expect(parseLogDateRange("2026/06/01", "2026/06/14")).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(parseLogDateRange("06-01-2026", "06-14-2026")).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(parseLogDateRange("2026-6-1", "2026-6-14")).toEqual({
      // 月日が 1 桁(ゼロ埋め無し)も無効
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it("時刻が付いていても fmt が違うので undefined(再加工せず捨てる)", () => {
    expect(parseLogDateRange("2026-06-01T12:00:00", undefined)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it("不正な日付文字列(SQL injection もどき)も undefined", () => {
    expect(parseLogDateRange("'; DROP TABLE", "'; DROP TABLE")).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it("from > to の論理エラーはここでは判定しない(SQL では空集合になるだけ)", () => {
    // 「未来の from」は意味が無いが、UI 側の責務でここは弾かない
    const r = parseLogDateRange("2026-12-31", "2026-01-01");
    expect(r.dateFrom).toBe("2026-12-31T00:00:00.000Z");
    expect(r.dateTo).toBe("2026-01-01T23:59:59.999Z");
  });
});

describe("parseLogPage", () => {
  it("正の整数文字列はその数を返す", () => {
    expect(parseLogPage("1")).toBe(1);
    expect(parseLogPage("2")).toBe(2);
    expect(parseLogPage("100")).toBe(100);
  });

  it("undefined / null / 空文字 はデフォルト 1", () => {
    expect(parseLogPage(undefined)).toBe(1);
    expect(parseLogPage(null)).toBe(1);
    expect(parseLogPage("")).toBe(1);
  });

  it("0 以下は 1 に倒す(0/-1 page は無意味)", () => {
    expect(parseLogPage("0")).toBe(1);
    expect(parseLogPage("-1")).toBe(1);
    expect(parseLogPage("-100")).toBe(1);
  });

  it("小数は floor(切り捨て)", () => {
    expect(parseLogPage("2.7")).toBe(2);
    expect(parseLogPage("1.999")).toBe(1);
  });

  it("数値に解釈できない文字列は 1", () => {
    expect(parseLogPage("abc")).toBe(1);
    expect(parseLogPage("NaN")).toBe(1);
    expect(parseLogPage("Infinity")).toBe(1);
    expect(parseLogPage("' OR 1=1")).toBe(1);
  });
});

describe("buildLogsUrl", () => {
  const path = "/agency/marketing/logs";

  it("空の current + 空の updates なら path のみ(? も付けない)", () => {
    expect(buildLogsUrl(path, "", {})).toBe(path);
  });

  it("status を新規セットすると ?status=sent になる", () => {
    expect(buildLogsUrl(path, "", { status: "sent" })).toBe(`${path}?status=sent`);
  });

  it("status を空文字で渡すと URL からキーを削除する", () => {
    expect(buildLogsUrl(path, "status=failed", { status: "" })).toBe(path);
  });

  it("既存クエリは保持されつつ updates だけマージされる", () => {
    expect(buildLogsUrl(path, "scenario=abc", { status: "sent" })).toBe(
      `${path}?scenario=abc&status=sent`,
    );
  });

  it("フィルタ更新時は page を自動でリセット(2 ページ目で絞り込みを変えた → page=1 に戻す)", () => {
    expect(buildLogsUrl(path, "page=3", { status: "sent" })).toBe(`${path}?status=sent`);
  });

  it("from / to / scenario の更新でも page リセットされる", () => {
    expect(buildLogsUrl(path, "page=2", { from: "2026-06-01" })).toBe(`${path}?from=2026-06-01`);
    expect(buildLogsUrl(path, "page=2", { to: "2026-06-30" })).toBe(`${path}?to=2026-06-30`);
    expect(buildLogsUrl(path, "page=2", { scenario: "abc" })).toBe(`${path}?scenario=abc`);
  });

  it("page だけの更新ならフィルタは保持、page は更新される", () => {
    expect(buildLogsUrl(path, "status=sent&page=1", { page: "2" })).toBe(
      `${path}?status=sent&page=2`,
    );
  });

  it("page=1 は default なので URL から消す(共有しやすく短く)", () => {
    expect(buildLogsUrl(path, "status=sent&page=3", { page: "1" })).toBe(`${path}?status=sent`);
  });

  it("既存に同じ key があれば置き換える(重複追加しない)", () => {
    expect(buildLogsUrl(path, "status=sent", { status: "failed" })).toBe(`${path}?status=failed`);
  });

  it("複数 updates をまとめて反映できる(scenario + status を同時に)", () => {
    const url = buildLogsUrl(path, "page=5", { scenario: "abc", status: "sent" });
    // URLSearchParams の順序は insert 順
    expect(url).toBe(`${path}?scenario=abc&status=sent`);
  });

  it("path にハッシュ等の特殊文字が含まれていてもそのまま使う", () => {
    expect(buildLogsUrl("/agency/marketing/logs#top", "", { status: "sent" })).toBe(
      "/agency/marketing/logs#top?status=sent",
    );
  });
});
