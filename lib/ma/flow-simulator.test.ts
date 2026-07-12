import { describe, expect, it } from "vitest";

import { formatElapsed, simulateFlow, type SimStep, type VirtualFriend } from "./flow-simulator";

const NOW = new Date("2026-07-12T12:00:00Z");
const TAG_A = "11111111-1111-1111-1111-111111111111";

function makeFriend(overrides: Partial<VirtualFriend> = {}): VirtualFriend {
  return {
    days_since_added: 0,
    days_since_last_activity: 0,
    tag_ids: [],
    fields: [],
    ...overrides,
  };
}

describe("formatElapsed", () => {
  it("0 秒は「即時」", () => {
    expect(formatElapsed(0)).toBe("即時");
  });
  it("秒 / 分 / 時間 / 日で切り替わる", () => {
    expect(formatElapsed(30)).toBe("30秒後");
    expect(formatElapsed(120)).toBe("2分後");
    expect(formatElapsed(3600)).toBe("1時間後");
    expect(formatElapsed(86400)).toBe("1日後");
    expect(formatElapsed(86400 * 3)).toBe("3日後");
  });
});

describe("simulateFlow - シンプルな直列 Flow", () => {
  const steps: SimStep[] = [
    {
      step_order: 1,
      name: "ウェルカム",
      action_type: "send_message",
      delay_from_previous_seconds: 0,
      next_step_on_default: 2,
    },
    {
      step_order: 2,
      name: "3日後リマインド",
      action_type: "send_message",
      delay_from_previous_seconds: 86400 * 3,
      next_step_on_default: 3,
    },
    {
      step_order: 3,
      name: "終了",
      action_type: "stop",
      delay_from_previous_seconds: 0,
    },
  ];

  it("先頭 → 3 日後 → stop で終了", () => {
    const result = simulateFlow(steps, makeFriend(), NOW);
    expect(result.truncated).toBe(false);
    expect(result.timeline.length).toBe(3);
    expect(result.timeline[0].elapsed_label).toBe("即時");
    expect(result.timeline[1].elapsed_label).toBe("3日後");
    expect(result.timeline[2].terminal).toBe("stop");
  });
});

describe("simulateFlow - branch", () => {
  const steps: SimStep[] = [
    {
      step_order: 1,
      name: "分岐:タグ有無",
      action_type: "branch",
      delay_from_previous_seconds: 0,
      branch_condition_json: { kind: "has_tag", tag_id: TAG_A },
      next_step_on_true: 2,
      next_step_on_false: 3,
    },
    {
      step_order: 2,
      name: "タグあり側",
      action_type: "send_message",
      delay_from_previous_seconds: 0,
      next_step_on_default: null,
    },
    {
      step_order: 3,
      name: "タグなし側",
      action_type: "send_message",
      delay_from_previous_seconds: 0,
      next_step_on_default: null,
    },
  ];

  it("タグを持つ → true 側へ", () => {
    const result = simulateFlow(steps, makeFriend({ tag_ids: [TAG_A] }), NOW);
    expect(result.timeline[0].branch_taken).toBe("true");
    expect(result.timeline[1].step_order).toBe(2);
  });

  it("タグ無し → false 側へ", () => {
    const result = simulateFlow(steps, makeFriend(), NOW);
    expect(result.timeline[0].branch_taken).toBe("false");
    expect(result.timeline[1].step_order).toBe(3);
  });
});

describe("simulateFlow - 存在しないステップは step_missing で終了", () => {
  const steps: SimStep[] = [
    {
      step_order: 1,
      name: null,
      action_type: "send_message",
      delay_from_previous_seconds: 0,
      next_step_on_default: 99,
    },
  ];
  it("step_missing", () => {
    const result = simulateFlow(steps, makeFriend(), NOW);
    expect(result.timeline[result.timeline.length - 1].terminal).toBe("step_missing");
  });
});

describe("simulateFlow - 無限ループは MAX_STEPS で切る", () => {
  const steps: SimStep[] = [
    {
      step_order: 1,
      name: "self loop",
      action_type: "wait",
      delay_from_previous_seconds: 60,
      next_step_on_default: 1,
    },
  ];
  it("truncated=true", () => {
    const result = simulateFlow(steps, makeFriend(), NOW);
    expect(result.truncated).toBe(true);
    expect(result.timeline.length).toBe(50);
  });
});
