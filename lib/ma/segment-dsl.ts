/**
 * セグメント / 分岐 条件 の DSL 型 定義 + Zod スキーマ
 *
 * SegmentCondition = セグメント と Flow 分岐 で 共通 の 木構造 条件。
 * Phase 1 で 実装 する のは 8 種 の kind + composite (and / or / not)。
 * Phase 2 以降 の kind (score_* / entry_source_in / conversion_event_*) は
 * 型 上 は 定義 する が、 PG 側 評価 では 常に false (スタブ) と なる。
 *
 * 使用 場所 :
 *   ・line_segments.filter_dsl_json の 型 (root: SegmentCondition)
 *   ・ma_flow_steps.branch_condition_json (Phase 1-B 以降)
 *   ・lib/ma/segment-eval.ts (in-memory 評価)
 *   ・lib/ma/segment-queries.ts (RPC 呼び出し)
 *
 * 設計 :
 *   ・docs/line-lstep-ma-design.md §5.1
 *   ・docs/line-lstep-ma-phase1-plan.md §4.1
 */
import { z } from "zod";

// ────────────────────────────────────────
// Leaf 条件 の Zod スキーマ (13 種)
// ────────────────────────────────────────

const HasTagSchema = z.object({
  kind: z.literal("has_tag"),
  tag_id: z.string().uuid(),
});

const NotHasTagSchema = z.object({
  kind: z.literal("not_has_tag"),
  tag_id: z.string().uuid(),
});

// Phase 2 予約:engagement_score 列 が 追加 されるまで PG 側 は 常に false
const ScoreGteSchema = z.object({
  kind: z.literal("score_gte"),
  value: z.number().int(),
});
const ScoreLteSchema = z.object({
  kind: z.literal("score_lte"),
  value: z.number().int(),
});

const FieldEqualsSchema = z.object({
  kind: z.literal("field_equals"),
  key: z.string().min(1),
  value: z.string(),
});
const FieldExistsSchema = z.object({
  kind: z.literal("field_exists"),
  key: z.string().min(1),
});

const DaysSinceLastActivityGteSchema = z.object({
  kind: z.literal("days_since_last_activity_gte"),
  days: z.number().int().nonnegative(),
});
const DaysSinceAddedLteSchema = z.object({
  kind: z.literal("days_since_added_lte"),
  days: z.number().int().nonnegative(),
});
const DaysSinceAddedGteSchema = z.object({
  kind: z.literal("days_since_added_gte"),
  days: z.number().int().nonnegative(),
});

// Phase 3 予約:entry_source_code 列 が 追加 されるまで PG 側 は 常に false
const EntrySourceInSchema = z.object({
  kind: z.literal("entry_source_in"),
  codes: z.array(z.string()).min(1),
});

// Phase 2 予約:ma_conversion_events が 追加 されるまで PG 側 は 常に false
const ConversionEventPresentSchema = z.object({
  kind: z.literal("conversion_event_present"),
  event_key: z.string().min(1),
  within_days: z.number().int().positive(),
});
const ConversionEventAbsentSchema = z.object({
  kind: z.literal("conversion_event_absent"),
  event_key: z.string().min(1),
  within_days: z.number().int().positive(),
});

const ClickedLinkInFlowSchema = z.object({
  kind: z.literal("clicked_link_in_flow"),
  flow_id: z.string().uuid(),
});

// ────────────────────────────────────────
// Leaf 条件 の 合成 (discriminated union)
// ────────────────────────────────────────
const LeafConditionSchema = z.discriminatedUnion("kind", [
  HasTagSchema,
  NotHasTagSchema,
  ScoreGteSchema,
  ScoreLteSchema,
  FieldEqualsSchema,
  FieldExistsSchema,
  DaysSinceLastActivityGteSchema,
  DaysSinceAddedLteSchema,
  DaysSinceAddedGteSchema,
  EntrySourceInSchema,
  ConversionEventPresentSchema,
  ConversionEventAbsentSchema,
  ClickedLinkInFlowSchema,
]);

export type LeafCondition = z.infer<typeof LeafConditionSchema>;

// ────────────────────────────────────────
// 再帰 型:leaf + composite (and / or / not)
// ────────────────────────────────────────
export type SegmentCondition =
  | LeafCondition
  | { kind: "and"; conditions: SegmentCondition[] }
  | { kind: "or"; conditions: SegmentCondition[] }
  | { kind: "not"; condition: SegmentCondition };

// Zod で 再帰 スキーマ を 定義 (z.lazy)
export const SegmentConditionSchema: z.ZodType<SegmentCondition> = z.lazy(() =>
  z.union([
    LeafConditionSchema,
    z.object({
      kind: z.literal("and"),
      conditions: z.array(SegmentConditionSchema),
    }),
    z.object({
      kind: z.literal("or"),
      conditions: z.array(SegmentConditionSchema),
    }),
    z.object({
      kind: z.literal("not"),
      condition: SegmentConditionSchema,
    }),
  ]),
);

// ────────────────────────────────────────
// SegmentFilter (line_segments.filter_dsl_json の 型)
// ────────────────────────────────────────
export const SegmentFilterSchema = z.object({
  root: SegmentConditionSchema,
});

export type SegmentFilter = z.infer<typeof SegmentFilterSchema>;

/**
 * 「全員 マッチ」 の 空 フィルタ を 生成 (root は 空 and)。
 * PG 側 build_segment_where は 空 and で 'true' を 返す ので 全員 一致 に なる。
 */
export function emptyFilter(): SegmentFilter {
  return { root: { kind: "and", conditions: [] } };
}

/**
 * Phase 1 で PG 側 が 実装 済 の kind 一覧。
 * それ 以外 の kind は PG 側 で 常に false と 評価 される (仕様)。
 */
export const PHASE1_IMPLEMENTED_KINDS = [
  "has_tag",
  "not_has_tag",
  "field_equals",
  "field_exists",
  "days_since_last_activity_gte",
  "days_since_added_lte",
  "days_since_added_gte",
  "clicked_link_in_flow",
  "and",
  "or",
  "not",
] as const satisfies readonly SegmentCondition["kind"][];

/**
 * その kind が Phase 1 で 実装 済 か。 Phase 2 予約 kind の UI 側 で
 * 「Phase 2 で 実装 予定」バッジ を 出す 判定 に 使う。
 */
export function isPhase1ImplementedKind(kind: SegmentCondition["kind"]): boolean {
  return (PHASE1_IMPLEMENTED_KINDS as readonly string[]).includes(kind);
}
