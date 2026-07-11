/**
 * SegmentCondition の in-memory 評価 テスト。
 *
 * PG 側 (build_segment_where) と 挙動 が 一致 する こと が 契約 なので、
 * 各 kind と composite (and / or / not / ネスト) を 網羅 する。
 * PG 側 の 挙動 (空 and → true、 空 or → false、 未実装 kind → false) も 突き合わせ る。
 */
import { describe, expect, it } from "vitest";

import { SegmentFilterSchema, type SegmentCondition } from "./segment-dsl";
import {
  evaluateSegmentCondition,
  evaluateSegmentFilter,
  type SegmentEvalContext,
} from "./segment-eval";

const TAG_A = "11111111-1111-1111-1111-111111111111";
const TAG_B = "22222222-2222-2222-2222-222222222222";
const TAG_C = "33333333-3333-3333-3333-333333333333";
const FLOW_X = "44444444-4444-4444-4444-444444444444";

// テスト 基準 時刻 : 2026-07-11 12:00:00 UTC
const NOW = new Date("2026-07-11T12:00:00Z");

function makeCtx(overrides: Partial<SegmentEvalContext> = {}): SegmentEvalContext {
  return {
    organization_id: "org-1",
    line_user_id: "U1234567890",
    created_at: new Date("2026-06-11T12:00:00Z"), // 30 日前
    last_activity_at: new Date("2026-07-10T12:00:00Z"), // 1 日前
    tag_ids: new Set(),
    fields: new Map(),
    clicked_flow_ids: new Set(),
    engagement_score: 0,
    entry_source_code: null,
    ...overrides,
  };
}

describe("evaluateSegmentCondition - has_tag / not_has_tag", () => {
  it("タグ を 持って いる なら has_tag = true", () => {
    const ctx = makeCtx({ tag_ids: new Set([TAG_A]) });
    expect(evaluateSegmentCondition({ kind: "has_tag", tag_id: TAG_A }, ctx, NOW)).toBe(true);
  });

  it("タグ を 持って いない なら has_tag = false", () => {
    const ctx = makeCtx({ tag_ids: new Set([TAG_B]) });
    expect(evaluateSegmentCondition({ kind: "has_tag", tag_id: TAG_A }, ctx, NOW)).toBe(false);
  });

  it("not_has_tag は 逆 の 結果", () => {
    const ctx = makeCtx({ tag_ids: new Set([TAG_A]) });
    expect(evaluateSegmentCondition({ kind: "not_has_tag", tag_id: TAG_A }, ctx, NOW)).toBe(false);
    expect(evaluateSegmentCondition({ kind: "not_has_tag", tag_id: TAG_B }, ctx, NOW)).toBe(true);
  });
});

describe("evaluateSegmentCondition - field_equals / field_exists", () => {
  it("field_equals は key と value 両方 一致 で true", () => {
    const ctx = makeCtx({ fields: new Map([["希望勤務地", "東京"]]) });
    expect(
      evaluateSegmentCondition(
        { kind: "field_equals", key: "希望勤務地", value: "東京" },
        ctx,
        NOW,
      ),
    ).toBe(true);
    expect(
      evaluateSegmentCondition(
        { kind: "field_equals", key: "希望勤務地", value: "大阪" },
        ctx,
        NOW,
      ),
    ).toBe(false);
  });

  it("field_exists は key の 存在 のみ 見る (value 問わず)", () => {
    const ctx = makeCtx({ fields: new Map([["職務要約", ""]]) });
    expect(evaluateSegmentCondition({ kind: "field_exists", key: "職務要約" }, ctx, NOW)).toBe(
      true,
    );
    expect(evaluateSegmentCondition({ kind: "field_exists", key: "希望勤務地" }, ctx, NOW)).toBe(
      false,
    );
  });
});

describe("evaluateSegmentCondition - days_since_*", () => {
  it("last_activity_at が N 日 以上 前 なら true (境界 も 含む)", () => {
    const ctx = makeCtx({ last_activity_at: new Date("2026-07-08T12:00:00Z") }); // 3 日前
    expect(
      evaluateSegmentCondition({ kind: "days_since_last_activity_gte", days: 3 }, ctx, NOW),
    ).toBe(true);
    expect(
      evaluateSegmentCondition({ kind: "days_since_last_activity_gte", days: 4 }, ctx, NOW),
    ).toBe(false);
  });

  it("days_since_added_lte は 「追加 から N 日 以下」", () => {
    const ctx = makeCtx({ created_at: new Date("2026-07-04T12:00:00Z") }); // 7 日前
    expect(evaluateSegmentCondition({ kind: "days_since_added_lte", days: 7 }, ctx, NOW)).toBe(
      true,
    );
    expect(evaluateSegmentCondition({ kind: "days_since_added_lte", days: 6 }, ctx, NOW)).toBe(
      false,
    );
  });

  it("days_since_added_gte は 「追加 から N 日 以上」", () => {
    const ctx = makeCtx({ created_at: new Date("2026-06-11T12:00:00Z") }); // 30 日前
    expect(evaluateSegmentCondition({ kind: "days_since_added_gte", days: 30 }, ctx, NOW)).toBe(
      true,
    );
    expect(evaluateSegmentCondition({ kind: "days_since_added_gte", days: 31 }, ctx, NOW)).toBe(
      false,
    );
  });
});

describe("evaluateSegmentCondition - clicked_link_in_flow", () => {
  it("その Flow で クリック 履歴 が あれば true", () => {
    const ctx = makeCtx({ clicked_flow_ids: new Set([FLOW_X]) });
    expect(
      evaluateSegmentCondition({ kind: "clicked_link_in_flow", flow_id: FLOW_X }, ctx, NOW),
    ).toBe(true);
    expect(
      evaluateSegmentCondition(
        { kind: "clicked_link_in_flow", flow_id: "99999999-9999-9999-9999-999999999999" },
        ctx,
        NOW,
      ),
    ).toBe(false);
  });
});

describe("evaluateSegmentCondition - Phase 2/3 予約 kind (常に false)", () => {
  it("score_gte / score_lte / entry_source_in / conversion_event_* は 全 て false", () => {
    const ctx = makeCtx({ engagement_score: 999, entry_source_code: "qr_lp01" });
    expect(evaluateSegmentCondition({ kind: "score_gte", value: 0 }, ctx, NOW)).toBe(false);
    expect(evaluateSegmentCondition({ kind: "score_lte", value: 9999 }, ctx, NOW)).toBe(false);
    expect(
      evaluateSegmentCondition({ kind: "entry_source_in", codes: ["qr_lp01"] }, ctx, NOW),
    ).toBe(false);
    expect(
      evaluateSegmentCondition(
        { kind: "conversion_event_present", event_key: "application_submitted", within_days: 7 },
        ctx,
        NOW,
      ),
    ).toBe(false);
    expect(
      evaluateSegmentCondition(
        { kind: "conversion_event_absent", event_key: "meeting_confirmed", within_days: 7 },
        ctx,
        NOW,
      ),
    ).toBe(false);
  });
});

describe("evaluateSegmentCondition - composite (and / or / not)", () => {
  it("and:全 て 真 で 初めて true", () => {
    const ctx = makeCtx({ tag_ids: new Set([TAG_A, TAG_B]) });
    const cond: SegmentCondition = {
      kind: "and",
      conditions: [
        { kind: "has_tag", tag_id: TAG_A },
        { kind: "has_tag", tag_id: TAG_B },
      ],
    };
    expect(evaluateSegmentCondition(cond, ctx, NOW)).toBe(true);
    // TAG_B を 剥がす と false
    const ctx2 = makeCtx({ tag_ids: new Set([TAG_A]) });
    expect(evaluateSegmentCondition(cond, ctx2, NOW)).toBe(false);
  });

  it("or:1 つ でも 真 で true", () => {
    const ctx = makeCtx({ tag_ids: new Set([TAG_C]) });
    const cond: SegmentCondition = {
      kind: "or",
      conditions: [
        { kind: "has_tag", tag_id: TAG_A },
        { kind: "has_tag", tag_id: TAG_C },
      ],
    };
    expect(evaluateSegmentCondition(cond, ctx, NOW)).toBe(true);
  });

  it("not:内側 を 反転", () => {
    const ctx = makeCtx({ tag_ids: new Set([TAG_A]) });
    expect(
      evaluateSegmentCondition(
        { kind: "not", condition: { kind: "has_tag", tag_id: TAG_A } },
        ctx,
        NOW,
      ),
    ).toBe(false);
    expect(
      evaluateSegmentCondition(
        { kind: "not", condition: { kind: "has_tag", tag_id: TAG_B } },
        ctx,
        NOW,
      ),
    ).toBe(true);
  });

  it("空 and は true、 空 or は false (PG 側 と 一致)", () => {
    const ctx = makeCtx();
    expect(evaluateSegmentCondition({ kind: "and", conditions: [] }, ctx, NOW)).toBe(true);
    expect(evaluateSegmentCondition({ kind: "or", conditions: [] }, ctx, NOW)).toBe(false);
  });

  it("ネスト 3 段:(A ∧ ¬B) ∨ (C ∧ 30 日超)", () => {
    const cond: SegmentCondition = {
      kind: "or",
      conditions: [
        {
          kind: "and",
          conditions: [
            { kind: "has_tag", tag_id: TAG_A },
            { kind: "not", condition: { kind: "has_tag", tag_id: TAG_B } },
          ],
        },
        {
          kind: "and",
          conditions: [
            { kind: "has_tag", tag_id: TAG_C },
            { kind: "days_since_last_activity_gte", days: 30 },
          ],
        },
      ],
    };
    // ケース 1:TAG_A あり ∧ TAG_B なし → 左枝 true
    expect(evaluateSegmentCondition(cond, makeCtx({ tag_ids: new Set([TAG_A]) }), NOW)).toBe(true);
    // ケース 2:TAG_A あり ∧ TAG_B あり → 左枝 false、 右枝 も false → 全体 false
    expect(evaluateSegmentCondition(cond, makeCtx({ tag_ids: new Set([TAG_A, TAG_B]) }), NOW)).toBe(
      false,
    );
    // ケース 3:TAG_C あり ∧ 45 日 前 活動 → 右枝 true
    const ctx3 = makeCtx({
      tag_ids: new Set([TAG_C]),
      last_activity_at: new Date("2026-05-27T12:00:00Z"), // 45 日前
    });
    expect(evaluateSegmentCondition(cond, ctx3, NOW)).toBe(true);
  });
});

describe("evaluateSegmentFilter (root ラッパ)", () => {
  it("root で 包ん でも 同一 結果", () => {
    const ctx = makeCtx({ tag_ids: new Set([TAG_A]) });
    const filter = { root: { kind: "has_tag" as const, tag_id: TAG_A } };
    expect(evaluateSegmentFilter(filter, ctx, NOW)).toBe(true);
  });
});

describe("SegmentFilterSchema (Zod 検証)", () => {
  it("valid な filter は parse を 通す", () => {
    const filter = {
      root: {
        kind: "and",
        conditions: [{ kind: "has_tag", tag_id: TAG_A }],
      },
    };
    expect(() => SegmentFilterSchema.parse(filter)).not.toThrow();
  });

  it("不正 な kind は 拒否", () => {
    const bad = { root: { kind: "unknown_kind", tag_id: TAG_A } };
    expect(() => SegmentFilterSchema.parse(bad)).toThrow();
  });

  it("has_tag に tag_id が UUID で ない と 拒否", () => {
    const bad = { root: { kind: "has_tag", tag_id: "not-a-uuid" } };
    expect(() => SegmentFilterSchema.parse(bad)).toThrow();
  });

  it("days が 負値 なら 拒否", () => {
    const bad = { root: { kind: "days_since_added_gte", days: -1 } };
    expect(() => SegmentFilterSchema.parse(bad)).toThrow();
  });

  it("ネスト and / or / not も parse できる", () => {
    const filter = {
      root: {
        kind: "not",
        condition: {
          kind: "or",
          conditions: [
            { kind: "has_tag", tag_id: TAG_A },
            {
              kind: "and",
              conditions: [
                { kind: "field_exists", key: "希望勤務地" },
                { kind: "days_since_added_gte", days: 7 },
              ],
            },
          ],
        },
      },
    };
    expect(() => SegmentFilterSchema.parse(filter)).not.toThrow();
  });
});
