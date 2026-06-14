import { describe, it, expect } from "vitest";
import { getDueStatus, SOON_THRESHOLD_HOURS } from "./due-status";

/**
 * getDueStatus のテスト。
 *
 * クライアント詳細(タスクの色分け)とクライアント一覧(期限超過バッジ)が
 * 同じ判定ロジックを共有しているため、ここを壊すと両方の見た目が同時に崩れる。
 * 5 状態(completed / overdue / soon / normal / none)の境界を全部叩く。
 */

// テスト用の固定 "現在時刻"。タイムゾーンに依存しない UTC で固定。
const NOW = new Date("2026-06-14T12:00:00Z");

function hoursFromNow(h: number): string {
  return new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();
}

describe("getDueStatus — 完了状態", () => {
  it("isDone=true は常に completed(他の引数に関係なく)", () => {
    expect(getDueStatus(null, NOW, true)).toBe("completed");
    expect(getDueStatus(hoursFromNow(-100), NOW, true)).toBe("completed"); // 期限超過でも
    expect(getDueStatus(hoursFromNow(100), NOW, true)).toBe("completed"); // 未来でも
    expect(getDueStatus(null, null, true)).toBe("completed"); // now が無くても
  });
});

describe("getDueStatus — マウント前(now=null)", () => {
  it("now が null なら常に normal(ハイドレーション前の SSR と一致させるため)", () => {
    expect(getDueStatus(hoursFromNow(-10), null, false)).toBe("normal"); // 期限超過でも
    expect(getDueStatus(hoursFromNow(10), null, false)).toBe("normal");
    expect(getDueStatus(null, null, false)).toBe("normal"); // 期限なしも normal に
  });
});

describe("getDueStatus — 期限なし", () => {
  it("dueAt=null なら none(色なし)", () => {
    expect(getDueStatus(null, NOW, false)).toBe("none");
  });
});

describe("getDueStatus — 期限超過(overdue)", () => {
  it("1 時間前は overdue", () => {
    expect(getDueStatus(hoursFromNow(-1), NOW, false)).toBe("overdue");
  });

  it("1 秒前でも overdue(境界)", () => {
    const oneSecBefore = new Date(NOW.getTime() - 1000).toISOString();
    expect(getDueStatus(oneSecBefore, NOW, false)).toBe("overdue");
  });

  it("数日前も overdue", () => {
    expect(getDueStatus(hoursFromNow(-72), NOW, false)).toBe("overdue");
  });
});

describe("getDueStatus — 期限間近(soon)", () => {
  it("1 時間後 は soon(48h 以内)", () => {
    expect(getDueStatus(hoursFromNow(1), NOW, false)).toBe("soon");
  });

  it("ちょうど 47h59m 後 は soon", () => {
    expect(getDueStatus(hoursFromNow(47.99), NOW, false)).toBe("soon");
  });

  it("ちょうど now と一致は overdue 扱い(due < now ではないが境界では due < t の条件で false)", () => {
    // 実装は `due < t` で overdue 判定。ちょうど一致なら overdue ではない → soon
    expect(getDueStatus(NOW.toISOString(), NOW, false)).toBe("soon");
  });
});

describe("getDueStatus — 通常(normal)", () => {
  it("48h ちょうど後 は normal(soon の境界の外)", () => {
    // `due < soonCutoff` で判定:due = t + 48h は due < t+48h が false → normal
    expect(getDueStatus(hoursFromNow(SOON_THRESHOLD_HOURS), NOW, false)).toBe("normal");
  });

  it("数日後 は normal", () => {
    expect(getDueStatus(hoursFromNow(72), NOW, false)).toBe("normal");
  });

  it("ずっと先(数週間後)も normal", () => {
    expect(getDueStatus(hoursFromNow(24 * 30), NOW, false)).toBe("normal");
  });
});

describe("getDueStatus — 不正な dueAt", () => {
  it("解釈できない文字列は new Date → NaN.getTime() → NaN になり、比較は全部 false → normal", () => {
    // due < t も due < soonCutoff も NaN 比較で false なので normal にフォールバック
    expect(getDueStatus("garbage", NOW, false)).toBe("normal");
  });
});

describe("SOON_THRESHOLD_HOURS", () => {
  it("48h(指示書のデフォルト)", () => {
    // しきい値を意図せず変更したらここで気付く。
    // 変更する場合はテストも一緒に直して、クライアント詳細/一覧の見た目を確認する。
    expect(SOON_THRESHOLD_HOURS).toBe(48);
  });
});
