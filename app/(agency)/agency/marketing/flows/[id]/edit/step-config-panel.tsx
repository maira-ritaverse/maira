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
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

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
  /** Flow の送信チャネル。 'email' なら件名編集を表示 */
  channel: string;
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
  channel,
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

  // AI 生成 Flow で「本当は◯◯したかった」情報を持っている場合、担当者に見せる
  const aiIntent = typeof cfg.ai_intent === "string" ? cfg.ai_intent : null;
  const aiBody = typeof cfg.ai_body === "string" ? cfg.ai_body : null;
  const aiTagName = typeof cfg.ai_tag_name === "string" ? cfg.ai_tag_name : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">ステップ {step.step_order} を編集</div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onDelete}>
          削除
        </Button>
      </div>

      {aiIntent && (
        <div className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900">
          <div className="mb-1 flex items-center gap-1 font-semibold">
            <AlertTriangle className="size-3.5" aria-hidden />
            AI からの引き継ぎ:このステップは未設定です
          </div>
          {aiIntent === "send_message" && aiBody && (
            <>
              <div className="mb-1">本来送りたかったメッセージ:</div>
              <div className="mb-2 rounded border border-amber-300 bg-white/60 p-2 whitespace-pre-wrap">
                {aiBody}
              </div>
              <div>
                「何をするステップか」を「メッセージを送る」に変更し、テンプレートを選ぶか、
                上のメッセージ本文でテンプレートを新規作成してから割り当ててください。
              </div>
            </>
          )}
          {(aiIntent === "assign_tag" || aiIntent === "remove_tag") && aiTagName && (
            <>
              <div className="mb-1">
                本来{aiIntent === "assign_tag" ? "付与" : "削除"}したかったタグ:
                <b className="ml-1">{aiTagName}</b>
              </div>
              <div>
                「何をするステップか」を「タグをつける /
                外す」に変更し、対応するタグを選択(または新規作成)してください。
              </div>
            </>
          )}
        </div>
      )}

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

      <DelayInput
        seconds={step.delay_from_previous_seconds}
        disabled={disabled}
        onChange={(next) => onChange({ delay_from_previous_seconds: next })}
      />

      {step.action_type === "send_message" && (
        <SendMessageEditor
          // template が切り替わったら local state をリセットするため、
          // key に template_id を含めて意図的に再マウントする
          key={step.template_id ?? "none"}
          templateId={step.template_id}
          templates={templates}
          disabled={disabled}
          channel={channel}
          onSelectTemplate={(id) => onChange({ template_id: id })}
        />
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

// ────────────────────────────────────────
// 待機時間の入力(プリセット + 日/時間/分)
// ────────────────────────────────────────

const DELAY_PRESETS: Array<{ label: string; seconds: number | "custom" }> = [
  { label: "すぐ", seconds: 0 },
  { label: "30分後", seconds: 1800 },
  { label: "1時間後", seconds: 3600 },
  { label: "3時間後", seconds: 10800 },
  { label: "半日後(12時間)", seconds: 43200 },
  { label: "1日後", seconds: 86400 },
  { label: "3日後", seconds: 259200 },
  { label: "1週間後", seconds: 604800 },
  { label: "カスタム", seconds: "custom" },
];

function secondsToParts(seconds: number): { d: number; h: number; m: number } {
  const total = Math.max(0, Math.floor(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return { d, h, m };
}

function partsToSeconds(d: number, h: number, m: number): number {
  return Math.max(0, d) * 86400 + Math.max(0, h) * 3600 + Math.max(0, m) * 60;
}

function DelayInput({
  seconds,
  disabled,
  onChange,
}: {
  seconds: number;
  disabled: boolean;
  onChange: (nextSeconds: number) => void;
}) {
  const parts = secondsToParts(seconds);
  const matchedPreset = DELAY_PRESETS.find(
    (p) => typeof p.seconds === "number" && p.seconds === seconds,
  );
  const presetValue = matchedPreset ? String(matchedPreset.seconds) : "custom";
  const isCustom = !matchedPreset;

  return (
    <div className="space-y-1">
      <Label>前のステップからの待機時間</Label>
      <select
        className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
        value={presetValue}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "custom") return; // 何もしない、下の日/時間/分で入力
          onChange(Number(raw));
        }}
      >
        {DELAY_PRESETS.map((p) => (
          <option key={String(p.seconds)} value={String(p.seconds)}>
            {p.label}
          </option>
        ))}
      </select>
      {isCustom && (
        <div className="text-muted-foreground grid grid-cols-3 gap-2 pt-1 text-xs">
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={365}
              value={parts.d}
              disabled={disabled}
              onChange={(e) => onChange(partsToSeconds(Number(e.target.value), parts.h, parts.m))}
              className="text-right"
            />
            <span className="shrink-0">日</span>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={23}
              value={parts.h}
              disabled={disabled}
              onChange={(e) => onChange(partsToSeconds(parts.d, Number(e.target.value), parts.m))}
              className="text-right"
            />
            <span className="shrink-0">時間</span>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={59}
              value={parts.m}
              disabled={disabled}
              onChange={(e) => onChange(partsToSeconds(parts.d, parts.h, Number(e.target.value)))}
              className="text-right"
            />
            <span className="shrink-0">分</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// メッセージ送信ステップの編集(テンプレ選択 + 本文プレビュー / 編集)
// ────────────────────────────────────────

function SendMessageEditor({
  templateId,
  templates,
  disabled,
  channel,
  onSelectTemplate,
}: {
  templateId: string | null;
  templates: MaTemplateOption[];
  disabled: boolean;
  channel: string;
  onSelectTemplate: (id: string | null) => void;
}) {
  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const [subject, setSubject] = useState<string>(selectedTemplate?.subject ?? "");
  const [body, setBody] = useState<string>(selectedTemplate?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const isEmail = channel === "email";
  const dirty = selectedTemplate
    ? body !== selectedTemplate.body || (isEmail && subject !== selectedTemplate.subject)
    : false;

  async function saveTemplate() {
    if (!selectedTemplate) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/agency/ma/templates/by-id/${selectedTemplate.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          // 件名はメール Flow の場合のみ送る(LINE Flow は subject を使わない)
          ...(isEmail ? { subject } : {}),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setSaveMsg(`保存失敗: ${b.message ?? b.error ?? res.status}`);
        return;
      }
      setSaveMsg("保存しました。次のページ再読み込みで反映されます");
    } catch (e) {
      setSaveMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="step-template">送信するメッセージ</Label>
          {!disabled && (
            <NewTemplateButton
              channel={channel}
              onCreated={(newTemplateId) => {
                onSelectTemplate(newTemplateId);
                // 新規テンプレは client には反映されていないので、
                // 保存後に親側で refetch する必要がある(次の Flow 保存で反映)
              }}
            />
          )}
        </div>
        <select
          id="step-template"
          className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
          value={templateId ?? ""}
          disabled={disabled}
          onChange={(e) => onSelectTemplate(e.target.value || null)}
        >
          <option value="">
            {templates.length === 0 ? "まだテンプレートがありません" : "選択してください"}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.scenario_name}
            </option>
          ))}
        </select>
        {templates.length === 0 && (
          <p className="text-muted-foreground text-xs">
            右上の「+ 新規作成」から作れます(AI 生成でも自動作成されます)。
          </p>
        )}
      </div>

      {selectedTemplate && (
        <div className="space-y-2 rounded border bg-slate-50/60 p-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">このステップで送られる内容</Label>
            <div className="flex items-center gap-2">
              {saveMsg && <span className="text-muted-foreground text-[10px]">{saveMsg}</span>}
              <button
                type="button"
                disabled={disabled || !dirty || saving}
                onClick={saveTemplate}
                className="rounded border border-emerald-500 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {saving ? "保存中..." : dirty ? "テンプレートを保存" : "変更なし"}
              </button>
            </div>
          </div>

          {isEmail && (
            <div className="space-y-1">
              <Label htmlFor="step-subject" className="text-[10px] text-slate-600">
                メール件名
              </Label>
              <Input
                id="step-subject"
                value={subject}
                disabled={disabled}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="例: ◯◯様 - 面談の日程調整のご案内"
                maxLength={200}
              />
            </div>
          )}

          <Label htmlFor="step-body" className="text-[10px] text-slate-600">
            {isEmail ? "メール本文" : "LINE メッセージ本文"}
          </Label>
          <textarea
            id="step-body"
            className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
            rows={6}
            value={body}
            disabled={disabled}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              isEmail
                ? "ここにメール本文を書いてください"
                : "ここに LINE メッセージを書いてください"
            }
            maxLength={4000}
          />
          <p className="text-muted-foreground text-[10px]">
            {body.length} / 4000 字 ・
            このメッセージは同じテンプレートを使う他のステップにも反映されます。
          </p>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// 新規テンプレート作成ボタン(インラインダイアログ)
// ────────────────────────────────────────

function NewTemplateButton({
  channel,
  onCreated,
}: {
  channel: string;
  onCreated: (templateId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEmail = channel === "email";

  async function create() {
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/ma/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          body: body.trim(),
          ...(isEmail ? { subject: subject.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(b.message ?? b.error ?? "作成に失敗しました");
        return;
      }
      const json = (await res.json()) as { id: string };
      onCreated(json.id);
      setOpen(false);
      setName("");
      setSubject("");
      setBody("");
      // ページを再読み込みして templates リストを更新する
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
      >
        + 新規作成
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-3 rounded-lg border bg-white p-4 shadow-lg">
        <div className="text-sm font-medium">新しいメッセージテンプレート</div>
        <div className="space-y-1">
          <Label htmlFor="new-tpl-name" className="text-xs">
            テンプレート名(管理用)
          </Label>
          <Input
            id="new-tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 面談前日リマインド"
            maxLength={200}
          />
        </div>
        {isEmail && (
          <div className="space-y-1">
            <Label htmlFor="new-tpl-subject" className="text-xs">
              メール件名
            </Label>
            <Input
              id="new-tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="例: 明日の面談についてのご案内"
              maxLength={200}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="new-tpl-body" className="text-xs">
            {isEmail ? "メール本文" : "LINE メッセージ本文"}
          </Label>
          <textarea
            id="new-tpl-body"
            className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              isEmail ? "ここに本文を書いてください" : "ここに LINE メッセージを書いてください"
            }
            maxLength={4000}
          />
          <p className="text-muted-foreground text-[10px]">{body.length} / 4000 字</p>
        </div>
        {error && (
          <p className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-2">
          <button
            type="button"
            className="rounded border px-3 py-1 text-xs hover:bg-slate-50"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="rounded bg-emerald-500 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={create}
            disabled={saving || !name.trim() || !body.trim()}
          >
            {saving ? "作成中..." : "作成してこのステップに割当"}
          </button>
        </div>
      </div>
    </div>
  );
}
