import { describe, it, expect } from "vitest";
import { aggregateSendLogStats } from "./queries";

/**
 * ma_send_logs の集計純粋関数テスト。
 *
 * getScenarioSendStats から DB アクセスを除いた中核ロジック。
 * scenario_id ごとに sent / failed / skipped をカウントし、
 * 未知の status は黙って無視する(列値域が将来広がっても落ちない契約)。
 */

const A = "scen-a";
const B = "scen-b";

describe("aggregateSendLogStats", () => {
  it("空配列なら空配列を返す", () => {
    expect(aggregateSendLogStats([])).toEqual([]);
  });

  it("1 行 sent → sent=1 / failed=0 / skipped=0", () => {
    expect(aggregateSendLogStats([{ scenario_id: A, status: "sent" }])).toEqual([
      { scenarioId: A, sent: 1, failed: 0, skipped: 0 },
    ]);
  });

  it("同一 scenario の sent / failed / skipped を全部カウント", () => {
    const stats = aggregateSendLogStats([
      { scenario_id: A, status: "sent" },
      { scenario_id: A, status: "sent" },
      { scenario_id: A, status: "failed" },
      { scenario_id: A, status: "skipped" },
      { scenario_id: A, status: "skipped" },
      { scenario_id: A, status: "skipped" },
    ]);
    expect(stats).toEqual([{ scenarioId: A, sent: 2, failed: 1, skipped: 3 }]);
  });

  it("複数 scenario を独立して集計", () => {
    const stats = aggregateSendLogStats([
      { scenario_id: A, status: "sent" },
      { scenario_id: B, status: "failed" },
      { scenario_id: A, status: "skipped" },
      { scenario_id: B, status: "failed" },
    ]);
    // 順序は Map の挿入順(最初に出てきた scenario_id 順)で来る
    expect(stats).toEqual([
      { scenarioId: A, sent: 1, failed: 0, skipped: 1 },
      { scenarioId: B, sent: 0, failed: 2, skipped: 0 },
    ]);
  });

  it("未知の status は黙って無視する(列値域が広がっても落ちない)", () => {
    const stats = aggregateSendLogStats([
      { scenario_id: A, status: "sent" },
      { scenario_id: A, status: "future_new_status" }, // ← 未知
      { scenario_id: A, status: "pending" }, // ← 未知
      { scenario_id: A, status: "failed" },
    ]);
    // sent=1, failed=1, skipped=0(未知の 2 行はどこにもカウントされない)
    expect(stats).toEqual([{ scenarioId: A, sent: 1, failed: 1, skipped: 0 }]);
  });

  it("初出 scenario でも 0/0/0 から始まる(他で計上した値の漏洩がない)", () => {
    const stats = aggregateSendLogStats([
      { scenario_id: A, status: "sent" },
      { scenario_id: A, status: "sent" },
      { scenario_id: A, status: "sent" },
      { scenario_id: B, status: "failed" }, // B は failed のみ
    ]);
    const b = stats.find((s) => s.scenarioId === B);
    expect(b).toEqual({ scenarioId: B, sent: 0, failed: 1, skipped: 0 });
  });

  it("呼び出し順序に依らず scenario_id ごとに正しく集計", () => {
    const stats = aggregateSendLogStats([
      { scenario_id: B, status: "sent" },
      { scenario_id: A, status: "sent" },
      { scenario_id: B, status: "sent" },
      { scenario_id: A, status: "failed" },
    ]);
    const a = stats.find((s) => s.scenarioId === A);
    const b = stats.find((s) => s.scenarioId === B);
    expect(a).toEqual({ scenarioId: A, sent: 1, failed: 1, skipped: 0 });
    expect(b).toEqual({ scenarioId: B, sent: 2, failed: 0, skipped: 0 });
  });
});
