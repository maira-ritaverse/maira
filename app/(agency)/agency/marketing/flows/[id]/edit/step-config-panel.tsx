"use client";

/**
 * 選択中 ステップ の 詳細 編集 パネル (右 サイドバー)。
 *
 * action_type ごと に 必要 な 項目 を 動的 に 出し 分け る:
 *   ・send_message: template_id (Phase 1 は 手打ち UUID)
 *   ・assign_tag / remove_tag: tag_id (action_config)
 *   ・set_field: key / value (action_config)
 *   ・branch: Segment と 同じ 視覚 ConditionEditor + true/false 分岐先
 *   ・add_score / wait / stop: 追加 入力 なし
 *
 * onChange で 親 (flow-editor) の state を 更新 する 制御 コンポーネント。
 *
 * Phase 1-F.2 (2026-07-12):
 *   ・branch の 分岐 条件 を JSON 手打ち から 視覚 ConditionEditor に 変更
 *   ・position_x / position_y を StepEditable に 追加 (自由 DAG 対応)
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineConversationTag } from "@/lib/line/conversation-tags";
import type { MaTemplateOption } from "@/lib/ma/flow-queries";
import type { SegmentCondition } from "@/lib/ma/segment-dsl";

import { ConditionEditor } from "../../../segments/condition-builder";

export type StepEditable = {
  step_order: number;
  name: string | null;
  delay_from_previous_seconds: number;
  action_type: string;
  action_config: Record<string, unknown>;
  template_id: string | null;
  branch_condition_json: unknown;
  next_step_on_true: number | null;
  next_step_on_false: number | null;
  next_step_on_default: number | null;
  goal_check_on_entry: boolean;
  /** Phase 1-F.2:自由 DAG エディタ の 位置 */
  position_x: number | null;
  position_y: number | null;
};

type Props = {
  step: StepEditable | null;
  allStepOrders: number[]; // 分岐先 選択肢
  onChange: (patch: Partial<StepEditable>) => void;
  onDelete: () => void;
  disabled: boolean;
  /** 自組織 の 会話 タグ (assign_tag / remove_tag / branch has_tag ドロップダウン 用) */
  tags: LineConversationTag[];
  /** 自組織 の テンプレ (send_message ドロップダウン 用) */
  templates: MaTemplateOption[];
};

const ACTION_TYPES = [
  { value: "send_message", label: "メッセージ 送信" },
  { value: "assign_tag", label: "タグ 付与" },
  { value: "remove_tag", label: "タグ 削除" },
  { value: "add_score", label: "スコア 加算 (Phase 2)" },
  { value: "set_field", label: "自由項目 更新" },
  { value: "wait", label: "待機 のみ" },
  { value: "branch", label: "分岐" },
  { value: "stop", label: "終了" },
];

export function StepConfigPanel({
  step,
  allStepOrders,
  onChange,
  onDelete,
  disabled,
  tags,
  templates,
}: Props) {
  if (!step) {
    return (
      <div className="border-muted text-muted-foreground rounded border border-dashed p-4 text-sm">
        キャンバス上 の ステップ を 選択 する と 詳細 を 編集 でき ます。
      </div>
    );
  }

  const cfg = step.action_config ?? {};
  const setCfg = (key: string, value: unknown) =>
    onChange({ action_config: { ...cfg, [key]: value } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Step {step.step_order} を 編集</div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onDelete}>
          削除
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="step-name">名前 (任意)</Label>
        <Input
          id="step-name"
          value={step.name ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ name: e.target.value || null })}
          maxLength={200}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="step-action">action_type</Label>
        <select
          id="step-action"
          className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
          value={step.action_type}
          disabled={disabled}
          onChange={(e) => onChange({ action_type: e.target.value })}
        >
          {ACTION_TYPES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="step-delay">前 ステップ から の 遅延 秒</Label>
        <Input
          id="step-delay"
          type="number"
          min={0}
          value={step.delay_from_previous_seconds}
          disabled={disabled}
          onChange={(e) =>
            onChange({ delay_from_previous_seconds: Math.max(0, Number(e.target.value)) })
          }
        />
      </div>

      {/* action_type 別 の 追加 フィールド */}
      {step.action_type === "send_message" && (
        <div className="space-y-1">
          <Label htmlFor="step-template">テンプレ</Label>
          {templates.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              自組織 に テンプレ が ありません。 まず{" "}
              <a href="/agency/marketing" target="_blank" rel="noreferrer" className="underline">
                MA 画面
              </a>{" "}
              で LINE プリセット を 有効化 して テンプレ を 編集 して ください。
            </p>
          ) : (
            <select
              id="step-template"
              className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
              value={step.template_id ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ template_id: e.target.value || null })}
            >
              <option value="">テンプレ を 選択</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.scenario_name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {(step.action_type === "assign_tag" || step.action_type === "remove_tag") && (
        <div className="space-y-1">
          <Label htmlFor="step-tag">タグ</Label>
          {tags.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              自組織 に タグ が ありません。 まず{" "}
              <a href="/agency/line/users" target="_blank" rel="noreferrer" className="underline">
                LINE ユーザー 画面
              </a>{" "}
              で タグ を 作成 して ください。
            </p>
          ) : (
            <select
              id="step-tag"
              className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
              value={String(cfg.tag_id ?? "")}
              disabled={disabled}
              onChange={(e) => setCfg("tag_id", e.target.value)}
            >
              <option value="">タグ を 選択</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {step.action_type === "set_field" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="step-field-key">key</Label>
            <Input
              id="step-field-key"
              value={String(cfg.key ?? "")}
              disabled={disabled}
              onChange={(e) => setCfg("key", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="step-field-value">value</Label>
            <Input
              id="step-field-value"
              value={String(cfg.value ?? "")}
              disabled={disabled}
              onChange={(e) => setCfg("value", e.target.value)}
            />
          </div>
        </>
      )}

      {step.action_type === "branch" && (
        <>
          <div className="space-y-1">
            <Label>分岐 条件 (視覚 ビルダー)</Label>
            <ConditionEditor
              condition={
                (step.branch_condition_json as SegmentCondition | null) ?? {
                  kind: "and",
                  conditions: [],
                }
              }
              disabled={disabled}
              onChange={(next) => onChange({ branch_condition_json: next })}
              tags={tags}
            />
            <p className="text-muted-foreground text-xs">
              Segment と 同じ 16 種 kind の 再帰 ツリー。 保存 は JSON。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="step-true">true → Step</Label>
              <select
                id="step-true"
                className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
                value={step.next_step_on_true ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    next_step_on_true: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">未指定</option>
                {allStepOrders
                  .filter((o) => o !== step.step_order)
                  .map((o) => (
                    <option key={o} value={o}>
                      Step {o}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="step-false">false → Step</Label>
              <select
                id="step-false"
                className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
                value={step.next_step_on_false ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    next_step_on_false: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">未指定</option>
                {allStepOrders
                  .filter((o) => o !== step.step_order)
                  .map((o) => (
                    <option key={o} value={o}>
                      Step {o}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
