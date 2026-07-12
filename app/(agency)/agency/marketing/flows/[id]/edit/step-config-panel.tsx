"use client";

/**
 * 選択中ステップの詳細編集パネル(右サイドバー)。
 *
 * 動作の種類ごとに必要な項目を出し分ける:
 *   ・メッセージ送信: テンプレート選択
 *   ・タグ付与 / タグ削除: タグ選択
 *   ・自由項目を更新: キーと値
 *   ・分岐: 条件ビルダー + Yes/No の次ステップ
 *   ・スコア加算 / 待機 / 終了: 追加入力なし
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
  position_x: number | null;
  position_y: number | null;
};

type Props = {
  step: StepEditable | null;
  allStepOrders: number[];
  onChange: (patch: Partial<StepEditable>) => void;
  onDelete: () => void;
  disabled: boolean;
  tags: LineConversationTag[];
  templates: MaTemplateOption[];
};

const ACTION_TYPES = [
  { value: "send_message", label: "メッセージを送る" },
  { value: "assign_tag", label: "タグをつける" },
  { value: "remove_tag", label: "タグを外す" },
  { value: "add_score", label: "スコアを加算(準備中)" },
  { value: "set_field", label: "自由項目を更新" },
  { value: "wait", label: "待つだけ" },
  { value: "branch", label: "条件で分岐" },
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
        キャンバス上のステップを選択すると、ここで編集できます。
      </div>
    );
  }

  const cfg = step.action_config ?? {};
  const setCfg = (key: string, value: unknown) =>
    onChange({ action_config: { ...cfg, [key]: value } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">ステップ {step.step_order} を編集</div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onDelete}>
          削除
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="step-name">ステップ名(任意)</Label>
        <Input
          id="step-name"
          value={step.name ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ name: e.target.value || null })}
          maxLength={200}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="step-action">何をするステップか</Label>
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
        <Label htmlFor="step-delay">前のステップからの待機時間(秒)</Label>
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
        <p className="text-muted-foreground text-xs">
          0 = すぐ / 3600 = 1時間後 / 86400 = 1日後 / 604800 = 1週間後
        </p>
      </div>

      {step.action_type === "send_message" && (
        <div className="space-y-1">
          <Label htmlFor="step-template">送信するテンプレート</Label>
          {templates.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              まだテンプレートがありません。
              <a href="/agency/marketing" target="_blank" rel="noreferrer" className="underline">
                MA 画面
              </a>{" "}
              でプリセットを有効化するか、AI 生成で自動作成してください。
            </p>
          ) : (
            <select
              id="step-template"
              className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
              value={step.template_id ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ template_id: e.target.value || null })}
            >
              <option value="">テンプレートを選択</option>
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
          <Label htmlFor="step-tag">対象のタグ</Label>
          {tags.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              まだタグがありません。まず{" "}
              <a href="/agency/line/users" target="_blank" rel="noreferrer" className="underline">
                LINE ユーザー画面
              </a>{" "}
              でタグを作成してください。
            </p>
          ) : (
            <select
              id="step-tag"
              className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
              value={String(cfg.tag_id ?? "")}
              disabled={disabled}
              onChange={(e) => setCfg("tag_id", e.target.value)}
            >
              <option value="">タグを選択</option>
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
            <Label htmlFor="step-field-key">項目の名前(例: 希望勤務地)</Label>
            <Input
              id="step-field-key"
              value={String(cfg.key ?? "")}
              disabled={disabled}
              onChange={(e) => setCfg("key", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="step-field-value">セットする値</Label>
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
            <Label>分岐の条件</Label>
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
              「タグを持っている」「N日以上前」などを組み合わせて条件を作れます。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="step-true">Yes のとき次へ</Label>
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
                      ステップ {o}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="step-false">No のとき次へ</Label>
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
                      ステップ {o}
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
