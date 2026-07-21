import { describe, expect, it } from "vitest";

import { parseLineHistoryCsv } from "./csv-parser";

describe("parseLineHistoryCsv", () => {
  it("基本 ヘッダ + 2 行 を パース", () => {
    const csv = [
      "日時,送信者,内容",
      "2026-06-20 15:44:00,Myairaテスト,はじめまして",
      "2026-06-20 15:47:00,Shunichi,始めました",
    ].join("\n");

    const result = parseLineHistoryCsv(csv, ["Myairaテスト"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].direction).toBe("outbound");
    expect(result.messages[0].text).toBe("はじめまして");
    expect(result.messages[1].direction).toBe("inbound");
    expect(result.messages[1].text).toBe("始めました");
  });

  it("英語 ヘッダ + ISO timestamp", () => {
    const csv = [
      "timestamp,sender,text",
      "2026-06-20T06:44:00Z,bot,Hello",
      "2026-06-20T06:47:00Z,user,Hi",
    ].join("\n");
    const result = parseLineHistoryCsv(csv, ["bot"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].direction).toBe("outbound");
    expect(result.messages[1].direction).toBe("inbound");
  });

  it("ヘッダ 列 不足 で エラー", () => {
    const csv = ["foo,bar", "1,2"].join("\n");
    const result = parseLineHistoryCsv(csv, []);
    expect(result.ok).toBe(false);
  });

  it("空 行 / 不正 timestamp は skip", () => {
    const csv = [
      "日時,送信者,内容",
      "2026-06-20 15:44:00,A,a",
      "不正,B,b",
      ",C,c",
      "2026/06/20 15:50,A,c",
    ].join("\n");
    const result = parseLineHistoryCsv(csv, ["A"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages).toHaveLength(2);
    expect(result.skipped).toBe(2);
  });

  it("ダブルクォート 囲み の カンマ を 含む 本文", () => {
    const csv = ["日時,送信者,内容", '2026-06-20 15:44:00,A,"hello, world"'].join("\n");
    const result = parseLineHistoryCsv(csv, ["A"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages[0].text).toBe("hello, world");
  });

  it("rowHash で 重複 検出 可能", () => {
    const csv = ["日時,送信者,内容", "2026-06-20 15:44:00,A,a", "2026-06-20 15:44:00,A,a"].join(
      "\n",
    );
    const result = parseLineHistoryCsv(csv, ["A"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages[0].rowHash).toBe(result.messages[1].rowHash);
  });
});
