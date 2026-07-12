"use client";

/**
 * 選択中 ステップ の 詳細 編集 パネル (右 サイドバー)。
 *
 * action_type ごと に 必要 な 項目 を 動的 に 出し 分け る:
 *   ・send_message: template_id (Phase 1 は 手打ち UUID)
 *   ・assign_tag / remove_tag: tag_id (action_config)
 *   ・set_field: key / value (action_config)
 *   ・branch: 分岐 条件 の JSON テキスト エリア、 true/false 分岐先
 *   ・add_score / wait / stop: 追加 入力 なし
 *
 * onChange で 親 (flow-editor) の state を 更新 する 制御 コンポーネント。
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
};

type Props = {
  step: StepEditable | null;
  allStepOrders: number[]; // 分岐先 選択肢
  onChange: (patch: Partial<StepEditable>) => void;
  onDelete: () => void;
  disabled: boolean;
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

export function StepConfigPanel({ step, allStepOrders, onChange, onDelete, disabled }: Props) {
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
          <Label htmlFor="step-template">template_id (UUID)</Label>
          <Input
            id="step-template"
            value={step.template_id ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ template_id: e.target.value || null })}
            placeholder="ma_templates.id"
          />
          <p className="text-muted-foreground text-xs">
            Phase 1-F では 手打ち。 テンプレ 選択 UI は 追って 追加。
          </p>
        </div>
      )}

      {(step.action_type === "assign_tag" || step.action_type === "remove_tag") && (
        <div className="space-y-1">
          <Label htmlFor="step-tag">tag_id (UUID)</Label>
          <Input
            id="step-tag"
            value={String(cfg.tag_id ?? "")}
            disabled={disabled}
            onChange={(e) => setCfg("tag_id", e.target.value)}
          />
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
            <Label htmlFor="step-branch">branch_condition_json</Label>
            <Textarea
              id="step-branch"
              value={
                step.branch_condition_json
                  ? JSON.stringify(step.branch_condition_json, null, 2)
                  : ""
              }
              disabled={disabled}
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw.trim()) return onChange({ branch_condition_json: null });
                try {
                  onChange({ branch_condition_json: JSON.parse(raw) });
                } catch {
                  // 不正 JSON は 保存 せず、 見た目 だけ 更新 させる ため に patch を text とし ない
                }
              }}
              rows={5}
              placeholder='{"kind": "has_tag", "tag_id": "..."}'
            />
            <p className="text-muted-foreground text-xs">
              SegmentCondition の JSON。 詳細 は docs/line-lstep-ma-design.md §5.1
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
