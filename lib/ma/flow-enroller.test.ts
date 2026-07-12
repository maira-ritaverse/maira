/**
 * flow-enroller の 純粋 部分 (isTriggerConfigMatch) の 単体 テスト。
 *
 * DB 依存 の enrollFriendToFlow / findMatchingFlowsForEvent /
 * dispatchFlowTrigger は 統合 テスト (dev 環境) で 担保 する。
 */
import { describe, expect, it } from "vitest";

import { isTriggerConfigMatch, type FlowMatchRow, type TriggerEvent } from "./flow-enroller";

const TAG_A = "11111111-1111-1111-1111-111111111111";
const TAG_B = "22222222-2222-2222-2222-222222222222";
const SEG_X = "33333333-3333-3333-3333-333333333333";

function makeFlow(overrides: Partial<FlowMatchRow>): FlowMatchRow {
  return {
    id: "flow-1",
    organization_id: "org-1",
    trigger_type: "friend_added",
    trigger_config: {},
    target_segment_id: null,
    allow_reentry: false,
    is_active: true,
    send_time_window_json: null,
    ...overrides,
  };
}

describe("isTriggerConfigMatch - trigger_type 不一致", () => {
  it("type が 違え ば 常に false", () => {
    const flow = makeFlow({ trigger_type: "friend_added" });
    const event: TriggerEvent = { type: "tag_assigned", line_user_id: "U1", tag_id: TAG_A };
    expect(isTriggerConfigMatch(flow, event)).toBe(false);
  });
});

describe("isTriggerConfigMatch - friend_added", () => {
  it("config 不問 で true", () => {
    const flow = makeFlow({ trigger_type: "friend_added" });
    expect(isTriggerConfigMatch(flow, { type: "friend_added", line_user_id: "U1" })).toBe(true);
  });
});

describe("isTriggerConfigMatch - tag_assigned / tag_removed", () => {
  it("config.tag_id と event.tag_id が 一致 で true", () => {
    const flow = makeFlow({ trigger_type: "tag_assigned", trigger_config: { tag_id: TAG_A } });
    expect(
      isTriggerConfigMatch(flow, { type: "tag_assigned", line_user_id: "U1", tag_id: TAG_A }),
    ).toBe(true);
  });
  it("tag_id 不一致 なら false", () => {
    const flow = makeFlow({ trigger_type: "tag_assigned", trigger_config: { tag_id: TAG_A } });
    expect(
      isTriggerConfigMatch(flow, { type: "tag_assigned", line_user_id: "U1", tag_id: TAG_B }),
    ).toBe(false);
  });
  it("tag_removed も 同じ ルール", () => {
    const flow = makeFlow({ trigger_type: "tag_removed", trigger_config: { tag_id: TAG_A } });
    expect(
      isTriggerConfigMatch(flow, { type: "tag_removed", line_user_id: "U1", tag_id: TAG_A }),
    ).toBe(true);
    expect(
      isTriggerConfigMatch(flow, { type: "tag_removed", line_user_id: "U1", tag_id: TAG_B }),
    ).toBe(false);
  });
});

describe("isTriggerConfigMatch - postback_received", () => {
  it("prefix 指定 で startsWith 一致", () => {
    const flow = makeFlow({
      trigger_type: "postback_received",
      trigger_config: { postback_data_prefix: "job_interest:" },
    });
    expect(
      isTriggerConfigMatch(flow, {
        type: "postback_received",
        line_user_id: "U1",
        postback_data: "job_interest:abc",
      }),
    ).toBe(true);
    expect(
      isTriggerConfigMatch(flow, {
        type: "postback_received",
        line_user_id: "U1",
        postback_data: "other_action:xxx",
      }),
    ).toBe(false);
  });

  it("完全一致 指定 で 完全一致 のみ true", () => {
    const flow = makeFlow({
      trigger_type: "postback_received",
      trigger_config: { postback_data: "confirm" },
    });
    expect(
      isTriggerConfigMatch(flow, {
        type: "postback_received",
        line_user_id: "U1",
        postback_data: "confirm",
      }),
    ).toBe(true);
    expect(
      isTriggerConfigMatch(flow, {
        type: "postback_received",
        line_user_id: "U1",
        postback_data: "confirm_extended",
      }),
    ).toBe(false);
  });

  it("config なし なら 全 postback に 反応 (true)", () => {
    const flow = makeFlow({ trigger_type: "postback_received", trigger_config: {} });
    expect(
      isTriggerConfigMatch(flow, {
        type: "postback_received",
        line_user_id: "U1",
        postback_data: "anything",
      }),
    ).toBe(true);
  });
});

describe("isTriggerConfigMatch - form_submitted", () => {
  it("form_id 一致 で true", () => {
    const flow = makeFlow({ trigger_type: "form_submitted", trigger_config: { form_id: "F1" } });
    expect(
      isTriggerConfigMatch(flow, { type: "form_submitted", line_user_id: "U1", form_id: "F1" }),
    ).toBe(true);
    expect(
      isTriggerConfigMatch(flow, { type: "form_submitted", line_user_id: "U1", form_id: "F2" }),
    ).toBe(false);
  });
});

describe("isTriggerConfigMatch - conversion_event", () => {
  it("event_key 一致 で true", () => {
    const flow = makeFlow({
      trigger_type: "conversion_event",
      trigger_config: { event_key: "meeting_confirmed" },
    });
    expect(
      isTriggerConfigMatch(flow, {
        type: "conversion_event",
        line_user_id: "U1",
        event_key: "meeting_confirmed",
        occurred_at: new Date(),
      }),
    ).toBe(true);
    expect(
      isTriggerConfigMatch(flow, {
        type: "conversion_event",
        line_user_id: "U1",
        event_key: "application_submitted",
        occurred_at: new Date(),
      }),
    ).toBe(false);
  });
});

describe("isTriggerConfigMatch - segment_matched", () => {
  it("segment_id 一致 で true", () => {
    const flow = makeFlow({
      trigger_type: "segment_matched",
      trigger_config: { segment_id: SEG_X },
    });
    expect(
      isTriggerConfigMatch(flow, {
        type: "segment_matched",
        line_user_id: "U1",
        segment_id: SEG_X,
      }),
    ).toBe(true);
  });
});

describe("isTriggerConfigMatch - manual / keyword_matched", () => {
  it("manual / keyword_matched は config 不問 で true (呼び出し 側 で 事前 絞込)", () => {
    const manual = makeFlow({ trigger_type: "manual" });
    expect(isTriggerConfigMatch(manual, { type: "manual", line_user_id: "U1" })).toBe(true);
    const kw = makeFlow({ trigger_type: "keyword_matched" });
    expect(
      isTriggerConfigMatch(kw, { type: "keyword_matched", line_user_id: "U1", keyword: "hello" }),
    ).toBe(true);
  });
});
