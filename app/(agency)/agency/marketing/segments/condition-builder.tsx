"use client";

/**
 * SegmentCondition を 再帰的 に 編集 する ツリー UI。
 *
 * 対応 kind:
 *   Composite:  and / or / not
 *   Phase 1 実装:has_tag / not_has_tag / days_since_last_activity_gte /
 *                days_since_added_lte / gte / field_equals / field_exists /
 *                clicked_link_in_flow
 *   Phase 2/3 予約:score_gte / score_lte / entry_source_in /
 *                   conversion_event_present / absent (PG 側 は false 固定)
 *
 * kind 変更 時 は デフォルト 値 に リセット される (旧 値 は 破棄)。
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineConversationTag } from "@/lib/line/conversation-tags";
import { isPhase1ImplementedKind, type SegmentCondition } from "@/lib/ma/segment-dsl";

type KindOption = { value: SegmentCondition["kind"]; label: string; group: string };

const KIND_OPTIONS: KindOption[] = [
  { value: "and", label: "すべての条件を満たす(AND)", group: "組み合わせ" },
  { value: "or", label: "いずれかの条件を満たす(OR)", group: "組み合わせ" },
  { value: "not", label: "条件を満たさない(NOT)", group: "組み合わせ" },
  { value: "has_tag", label: "タグを持っている", group: "タグ" },
  { value: "not_has_tag", label: "タグを持っていない", group: "タグ" },
  { value: "field_equals", label: "自由項目が特定の値", group: "自由項目" },
  { value: "field_exists", label: "自由項目が入力済み", group: "自由項目" },
  { value: "days_since_last_activity_gte", label: "最終活動から◯日以上", group: "活動" },
  { value: "days_since_added_gte", label: "追加から◯日以上", group: "活動" },
  { value: "days_since_added_lte", label: "追加から◯日以内", group: "活動" },
  { value: "clicked_link_in_flow", label: "Flow のリンクをクリック済", group: "行動" },
  { value: "score_gte", label: "スコア◯以上(準備中)", group: "準備中" },
  { value: "score_lte", label: "スコア◯以下(準備中)", group: "準備中" },
  { value: "entry_source_in", label: "登録元がいずれか(準備中)", group: "準備中" },
  { value: "conversion_event_present", label: "目標達成イベントあり(準備中)", group: "準備中" },
  { value: "conversion_event_absent", label: "目標達成イベントなし(準備中)", group: "準備中" },
];

/** kind 変更 時 に 挿入 する デフォルト 条件 */
function defaultConditionForKind(kind: SegmentCondition["kind"]): SegmentCondition {
  switch (kind) {
    case "and":
    case "or":
      return { kind, conditions: [] };
    case "not":
      return { kind, condition: { kind: "and", conditions: [] } };
    case "has_tag":
    case "not_has_tag":
      return { kind, tag_id: "" };
    case "score_gte":
    case "score_lte":
      return { kind, value: 0 };
    case "field_equals":
      return { kind, key: "", value: "" };
    case "field_exists":
      return { kind, key: "" };
    case "days_since_last_activity_gte":
    case "days_since_added_gte":
    case "days_since_added_lte":
      return { kind, days: 7 };
    case "entry_source_in":
      return { kind, codes: [] };
    case "conversion_event_present":
    case "conversion_event_absent":
      return { kind, event_key: "", within_days: 7 };
    case "clicked_link_in_flow":
      return { kind, flow_id: "" };
  }
}

type Props = {
  condition: SegmentCondition;
  onChange: (next: SegmentCondition) => void;
  depth?: number;
  disabled?: boolean;
  /** 親 が composite の 場合 の 削除 ボタン */
  onRemove?: () => void;
  /** タグ 一覧 (has_tag / not_has_tag の ドロップダウン 用)。 未 指定 なら UUID 手打ち。 */
  tags?: LineConversationTag[];
};

export function ConditionEditor({
  condition,
  onChange,
  depth = 0,
  disabled = false,
  onRemove,
  tags,
}: Props) {
  const changeKind = (nextKind: SegmentCondition["kind"]) => {
    onChange(defaultConditionForKind(nextKind));
  };

  const indent = depth * 12;
  const isPhase1 = isPhase1ImplementedKind(condition.kind);

  return (
    <div className="border-border space-y-2 rounded border p-2" style={{ marginLeft: indent }}>
      <div className="flex items-center gap-2">
        <select
          value={condition.kind}
          disabled={disabled}
          onChange={(e) => changeKind(e.target.value as SegmentCondition["kind"])}
          className="border-input bg-background flex-1 rounded border px-2 py-1 text-xs"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              [{o.group}] {o.label}
            </option>
          ))}
        </select>
        {!isPhase1 && (
          <span
            className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
            title="このタイプの条件はまだサポートしていません。実際の絞り込みでは常に false になります。"
          >
            準備中
          </span>
        )}
        {onRemove && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onRemove}
            className="h-7 px-2 text-xs"
          >
            ×
          </Button>
        )}
      </div>

      {/* kind 別 の 詳細 フィールド */}
      {(condition.kind === "and" || condition.kind === "or") && (
        <div className="space-y-2">
          {condition.conditions.length === 0 && (
            <p className="text-muted-foreground text-xs">
              条件がまだありません。「+ 条件を追加」で子条件を足してください。
            </p>
          )}
          {condition.conditions.map((sub, idx) => (
            <ConditionEditor
              key={idx}
              condition={sub}
              depth={depth + 1}
              disabled={disabled}
              tags={tags}
              onChange={(next) => {
                const nextConds = [...condition.conditions];
                nextConds[idx] = next;
                onChange({ ...condition, conditions: nextConds });
              }}
              onRemove={() => {
                const nextConds = condition.conditions.filter((_, i) => i !== idx);
                onChange({ ...condition, conditions: nextConds });
              }}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onChange({
                ...condition,
                conditions: [...condition.conditions, defaultConditionForKind("has_tag")],
              });
            }}
          >
            + 条件を追加
          </Button>
        </div>
      )}

      {condition.kind === "not" && (
        <ConditionEditor
          condition={condition.condition}
          depth={depth + 1}
          disabled={disabled}
          tags={tags}
          onChange={(next) => onChange({ ...condition, condition: next })}
        />
      )}

      {(condition.kind === "has_tag" || condition.kind === "not_has_tag") &&
        (tags && tags.length > 0 ? (
          <div className="space-y-1">
            <Label className="text-xs">タグ</Label>
            <select
              value={condition.tag_id}
              disabled={disabled}
              onChange={(e) => onChange({ ...condition, tag_id: e.target.value })}
              className="border-input bg-background h-8 w-full rounded border px-2 text-xs"
            >
              <option value="">タグ を 選択</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <LeafInputRow
            label="タグ ID(UUID)"
            value={condition.tag_id}
            disabled={disabled}
            onChange={(v) => onChange({ ...condition, tag_id: v })}
          />
        ))}

      {condition.kind === "field_equals" && (
        <div className="grid grid-cols-2 gap-2">
          <LeafInputRow
            label="key"
            value={condition.key}
            disabled={disabled}
            onChange={(v) => onChange({ ...condition, key: v })}
          />
          <LeafInputRow
            label="value"
            value={condition.value}
            disabled={disabled}
            onChange={(v) => onChange({ ...condition, value: v })}
          />
        </div>
      )}

      {condition.kind === "field_exists" && (
        <LeafInputRow
          label="key"
          value={condition.key}
          disabled={disabled}
          onChange={(v) => onChange({ ...condition, key: v })}
        />
      )}

      {(condition.kind === "days_since_last_activity_gte" ||
        condition.kind === "days_since_added_gte" ||
        condition.kind === "days_since_added_lte") && (
        <LeafNumberRow
          label="日数"
          value={condition.days}
          min={0}
          disabled={disabled}
          onChange={(v) => onChange({ ...condition, days: v })}
        />
      )}

      {(condition.kind === "score_gte" || condition.kind === "score_lte") && (
        <LeafNumberRow
          label="スコア"
          value={condition.value}
          disabled={disabled}
          onChange={(v) => onChange({ ...condition, value: v })}
        />
      )}

      {condition.kind === "entry_source_in" && (
        <LeafInputRow
          label="コード (カンマ 区切り)"
          value={condition.codes.join(",")}
          disabled={disabled}
          onChange={(v) =>
            onChange({
              ...condition,
              codes: v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      )}

      {(condition.kind === "conversion_event_present" ||
        condition.kind === "conversion_event_absent") && (
        <div className="grid grid-cols-2 gap-2">
          <LeafInputRow
            label="event_key"
            value={condition.event_key}
            disabled={disabled}
            onChange={(v) => onChange({ ...condition, event_key: v })}
          />
          <LeafNumberRow
            label="within_days"
            value={condition.within_days}
            min={1}
            disabled={disabled}
            onChange={(v) => onChange({ ...condition, within_days: v })}
          />
        </div>
      )}

      {condition.kind === "clicked_link_in_flow" && (
        <LeafInputRow
          label="flow_id (UUID)"
          value={condition.flow_id}
          disabled={disabled}
          onChange={(v) => onChange({ ...condition, flow_id: v })}
        />
      )}
    </div>
  );
}

function LeafInputRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}

function LeafNumberRow({
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-xs"
      />
    </div>
  );
}
