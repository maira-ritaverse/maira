"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/admin/toast/store";
import {
  HEARING_PII_TARGET_LABELS,
  HEARING_PII_TARGETS,
  type HearingPiiTarget,
  type HearingQuestionDefinition,
  type HearingQuestionInputType,
} from "@/lib/hearing-sheet-questions/types";

type Props = {
  initialTitle: string;
  initialQuestions: HearingQuestionDefinition[];
};

/** 質問フォームの編集可能フィールド(項目 ID は作成時のみ・編集不可)。 */
type QuestionFormValues = {
  label: string;
  helpText: string;
  inputType: HearingQuestionInputType;
  maxLength: string;
  mapsToPii: HearingPiiTarget | "";
  displayOrder: string;
};

function toFormValues(q: HearingQuestionDefinition): QuestionFormValues {
  return {
    label: q.label,
    helpText: q.helpText ?? "",
    inputType: q.inputType,
    maxLength: String(q.maxLength),
    mapsToPii: q.mapsToPii ?? "",
    displayOrder: String(q.displayOrder),
  };
}

const EMPTY_FORM: QuestionFormValues = {
  label: "",
  helpText: "",
  inputType: "textarea",
  maxLength: "2000",
  mapsToPii: "",
  displayOrder: "0",
};

/** 新規追加時の既定の表示順(既存の最大 + 10。無ければ 10)。末尾に並ぶようにする。 */
function nextDisplayOrder(questions: HearingQuestionDefinition[]): number {
  if (questions.length === 0) return 10;
  return Math.max(...questions.map((q) => q.displayOrder)) + 10;
}

export function HearingSheetManager({ initialTitle, initialQuestions }: Props) {
  const [questions, setQuestions] = useState<HearingQuestionDefinition[]>(initialQuestions);
  const { showToast } = useToast();

  // ---- タイトル ----
  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [savingTitle, setSavingTitle] = useState(false);

  const saveTitle = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      showToast("error", "タイトルを入力してください");
      return;
    }
    setSavingTitle(true);
    try {
      const res = await fetch("/api/agency/hearing-sheet-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSavedTitle(trimmed);
      showToast("success", "タイトルを保存しました");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSavingTitle(false);
    }
  };

  // ---- 新規追加 ----
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [createForm, setCreateForm] = useState<QuestionFormValues>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const openCreate = () => {
    setNewKey("");
    // 表示順は既存の末尾に並ぶ値を初期値にする(全部 0 になって並びが曖昧になるのを防ぐ)。
    setCreateForm({ ...EMPTY_FORM, displayOrder: String(nextDisplayOrder(questions)) });
    setShowCreate(true);
  };

  const create = async () => {
    if (!newKey.trim() || !createForm.label.trim()) {
      showToast("error", "項目 ID とラベルを入力してください");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/agency/hearing-sheet-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: newKey.trim(),
          label: createForm.label.trim(),
          help_text: createForm.helpText.trim() === "" ? null : createForm.helpText.trim(),
          input_type: createForm.inputType,
          max_length: Number(createForm.maxLength) || 2000,
          maps_to_pii: createForm.mapsToPii === "" ? null : createForm.mapsToPii,
          display_order: Number(createForm.displayOrder) || 0,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        question?: HearingQuestionDefinition;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.question) {
        setQuestions((prev) =>
          [...prev, json.question!].sort((a, b) => a.displayOrder - b.displayOrder),
        );
      }
      setShowCreate(false);
      setNewKey("");
      setCreateForm(EMPTY_FORM);
      showToast("success", "質問を追加しました");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setCreating(false);
    }
  };

  // ---- 編集 ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<QuestionFormValues>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = (q: HearingQuestionDefinition) => {
    setEditingId(q.id);
    setEditForm(toFormValues(q));
  };

  const saveEdit = async (q: HearingQuestionDefinition) => {
    if (!editForm.label.trim()) {
      showToast("error", "ラベルを入力してください");
      return;
    }
    setSavingEdit(true);
    try {
      const patch = {
        label: editForm.label.trim(),
        help_text: editForm.helpText.trim() === "" ? null : editForm.helpText.trim(),
        input_type: editForm.inputType,
        max_length: Number(editForm.maxLength) || 2000,
        maps_to_pii: editForm.mapsToPii === "" ? null : editForm.mapsToPii,
        display_order: Number(editForm.displayOrder) || 0,
      };
      const res = await fetch(`/api/agency/hearing-sheet-questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setQuestions((prev) =>
        prev
          .map((x) =>
            x.id === q.id
              ? {
                  ...x,
                  label: patch.label,
                  helpText: patch.help_text,
                  inputType: patch.input_type,
                  maxLength: patch.max_length,
                  mapsToPii: patch.maps_to_pii,
                  displayOrder: patch.display_order,
                }
              : x,
          )
          .sort((a, b) => a.displayOrder - b.displayOrder),
      );
      setEditingId(null);
      showToast("success", "質問を更新しました");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSavingEdit(false);
    }
  };

  // ---- 削除 ----
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const remove = async (q: HearingQuestionDefinition) => {
    if (deletingId) return; // 実行中は二重発火させない
    if (
      !confirm(
        `「${q.label}」を削除しますか?\n既存ヒアリングシートに入力済みの回答データ自体は残ります(再追加すれば再表示)。`,
      )
    ) {
      return;
    }
    setDeletingId(q.id);
    try {
      const res = await fetch(`/api/agency/hearing-sheet-questions/${q.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setQuestions((prev) => prev.filter((x) => x.id !== q.id));
      showToast("success", `「${q.label}」を削除しました`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setDeletingId(null);
    }
  };

  const titleDirty = title.trim() !== savedTitle;

  return (
    <div className="space-y-6">
      {/* タイトル設定 */}
      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-semibold">シートのタイトル</h2>
        <p className="text-muted-foreground text-xs">
          クライアント画面のヒアリングシートに表示される見出しです。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            className="max-w-xs"
          />
          <Button size="sm" onClick={saveTitle} disabled={savingTitle || !titleDirty}>
            {savingTitle ? "保存中…" : "保存"}
          </Button>
        </div>
      </Card>

      {/* 質問項目 */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">質問項目</h2>
            <span className="text-muted-foreground text-xs">{questions.length} 件</span>
          </div>
          <Button size="sm" onClick={openCreate} disabled={showCreate}>
            + 質問を追加
          </Button>
        </div>

        {showCreate && (
          <Card className="space-y-3 p-3">
            <h3 className="text-sm font-medium">新規質問</h3>
            <div className="space-y-1">
              <Label className="text-xs">
                項目 ID(英小文字で始まる英数字と _。回答データの識別子で、後から変更できません)
              </Label>
              <Input
                placeholder="例:family_status"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                maxLength={50}
              />
            </div>
            <QuestionFormFields values={createForm} onChange={setCreateForm} />
            <div className="flex gap-2">
              <Button size="sm" onClick={create} disabled={creating}>
                {creating ? "追加中…" : "追加"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowCreate(false);
                  setNewKey("");
                  setCreateForm(EMPTY_FORM);
                }}
              >
                キャンセル
              </Button>
            </div>
          </Card>
        )}

        <ul className="space-y-2">
          {questions.length === 0 && (
            <li className="text-muted-foreground py-6 text-center text-sm">
              まだ質問がありません。「+ 質問を追加」から作成してください。
            </li>
          )}
          {questions.map((q) => (
            <li key={q.id}>
              <Card className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{q.label}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {q.inputType === "text" ? "1 行" : "複数行"} ・ 最大 {q.maxLength} 字
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        表示順 {q.displayOrder}
                      </span>
                      {q.mapsToPii && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                          本人情報:{HEARING_PII_TARGET_LABELS[q.mapsToPii]}
                        </span>
                      )}
                    </div>
                    {q.helpText && (
                      <p className="text-muted-foreground mt-1 text-xs">{q.helpText}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={deletingId === q.id}
                      onClick={() => (editingId === q.id ? setEditingId(null) : startEdit(q))}
                    >
                      {editingId === q.id ? "閉じる" : "編集"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deletingId === q.id}
                      onClick={() => remove(q)}
                    >
                      {deletingId === q.id ? "削除中…" : "削除"}
                    </Button>
                  </div>
                </div>

                {editingId === q.id && (
                  <div className="space-y-3 border-t pt-3">
                    <QuestionFormFields values={editForm} onChange={setEditForm} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(q)} disabled={savingEdit}>
                        {savingEdit ? "保存中…" : "保存"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        キャンセル
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 作成 / 編集で共通の入力フィールド群(項目 ID は含まない)。 */
function QuestionFormFields({
  values,
  onChange,
}: {
  values: QuestionFormValues;
  onChange: (v: QuestionFormValues) => void;
}) {
  const set = (patch: Partial<QuestionFormValues>) => onChange({ ...values, ...patch });

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">表示ラベル</Label>
        <Input
          placeholder="例:ご家族構成"
          value={values.label}
          onChange={(e) => set({ label: e.target.value })}
          maxLength={100}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">補助説明(任意)</Label>
        <Input
          placeholder="質問の下に薄字で出す説明"
          value={values.helpText}
          onChange={(e) => set({ helpText: e.target.value })}
          maxLength={500}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          入力欄:
          <select
            value={values.inputType}
            onChange={(e) => set({ inputType: e.target.value as HearingQuestionInputType })}
            className="border-input bg-background rounded-lg border px-2 py-1 text-sm"
          >
            <option value="textarea">複数行</option>
            <option value="text">1 行</option>
          </select>
        </label>
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          最大文字数:
          <Input
            type="number"
            value={values.maxLength}
            onChange={(e) => set({ maxLength: e.target.value })}
            className="w-24"
            min={1}
            max={8000}
          />
        </label>
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          表示順:
          <Input
            type="number"
            value={values.displayOrder}
            onChange={(e) => set({ displayOrder: e.target.value })}
            className="w-20"
            min={0}
            max={9999}
          />
        </label>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">本人情報マッピング(任意)</Label>
        <select
          value={values.mapsToPii}
          onChange={(e) => set({ mapsToPii: e.target.value as HearingPiiTarget | "" })}
          className="border-input bg-background w-full max-w-xs rounded-lg border px-2 py-1 text-sm"
        >
          <option value="">なし</option>
          {HEARING_PII_TARGETS.map((t) => (
            <option key={t} value={t}>
              {HEARING_PII_TARGET_LABELS[t]}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-[11px]">
          設定すると、この回答からクライアント履歴書の本人情報を埋められます。
        </p>
      </div>
    </div>
  );
}
