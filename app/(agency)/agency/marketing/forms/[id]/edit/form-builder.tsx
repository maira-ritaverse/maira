"use client";

/**
 * フォームビルダーの Client 部分。
 * 質問配列を編集し、PATCH で全体を上書き保存する。
 */
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormQuestion } from "@/lib/forms/types";

type Props = {
  formId: string;
  initialTitle: string;
  initialDescription: string;
  initialSchema: FormQuestion[];
  initialPublished: boolean;
  publicToken: string;
  submissionCount: number;
  isAdmin: boolean;
};

const KIND_LABELS: Record<FormQuestion["kind"], string> = {
  text: "短いテキスト(1 行)",
  textarea: "長いテキスト(複数行)",
  select: "選択肢(1 つ選ぶ)",
};

function newQuestion(): FormQuestion {
  return {
    id: `q${Math.floor(Math.random() * 1e9).toString(36)}`,
    kind: "text",
    label: "",
    required: false,
  };
}

export function FormBuilder({
  formId,
  initialTitle,
  initialDescription,
  initialSchema,
  initialPublished,
  publicToken,
  submissionCount,
  isAdmin,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [schema, setSchema] = useState<FormQuestion[]>(initialSchema);
  const [published, setPublished] = useState(initialPublished);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  function updateQuestion(idx: number, patch: Partial<FormQuestion>) {
    setSchema((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  }
  function removeQuestion(idx: number) {
    setSchema((prev) => prev.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    setSchema((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function addQuestion() {
    setSchema((prev) => [...prev, newQuestion()]);
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/agency/forms/${formId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || initialTitle,
          description: description.trim() || null,
          schema_json: schema,
          is_published: published,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setSaveMsg(`保存失敗: ${body.message ?? body.error ?? res.status}`);
        return;
      }
      setSaveMsg("保存しました");
    } catch (e) {
      setSaveMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function copyPublicUrl() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(`${window.location.origin}/mf/${publicToken}`);
    setSaveMsg("公開 URL をコピーしました");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded border bg-slate-50 p-3 text-sm">
        <div>
          <span className="font-medium">公開状態:</span>{" "}
          {published ? (
            <span className="text-emerald-700">公開中</span>
          ) : (
            <span className="text-slate-500">非公開</span>
          )}
        </div>
        <div>
          <span className="font-medium">送信件数:</span> {submissionCount}
        </div>
        <div className="text-muted-foreground text-xs">公開 URL: /mf/{publicToken}</div>
        {published && (
          <Button variant="outline" size="sm" onClick={copyPublicUrl}>
            <Copy className="mr-1 size-3" aria-hidden />
            URL コピー
          </Button>
        )}
      </div>

      <div className="space-y-3 rounded border p-4">
        <div className="space-y-1">
          <Label htmlFor="form-title">フォーム名</Label>
          <Input
            id="form-title"
            value={title}
            disabled={!isAdmin}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="form-desc">説明(任意、フォーム上部に表示)</Label>
          <Input
            id="form-desc"
            value={description}
            disabled={!isAdmin}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="form-pub"
            type="checkbox"
            checked={published}
            disabled={!isAdmin}
            onChange={(e) => setPublished(e.target.checked)}
          />
          <Label htmlFor="form-pub" className="text-sm">
            このフォームを公開する
          </Label>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">質問</h2>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={addQuestion}
              disabled={schema.length >= 30}
            >
              + 質問を追加
            </Button>
          )}
        </div>
        {schema.length === 0 ? (
          <p className="text-muted-foreground rounded border border-dashed p-4 text-center text-sm">
            まだ質問がありません。「+ 質問を追加」から作ってください。
          </p>
        ) : (
          <div className="space-y-2">
            {schema.map((q, idx) => (
              <div key={q.id} className="space-y-2 rounded border p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label>質問文</Label>
                        <Input
                          value={q.label}
                          disabled={!isAdmin}
                          onChange={(e) => updateQuestion(idx, { label: e.target.value })}
                          maxLength={200}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>種別</Label>
                        <select
                          className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                          value={q.kind}
                          disabled={!isAdmin}
                          onChange={(e) =>
                            updateQuestion(idx, { kind: e.target.value as FormQuestion["kind"] })
                          }
                        >
                          {Object.entries(KIND_LABELS).map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {q.kind === "select" && (
                      <div className="space-y-1">
                        <Label>選択肢(改行区切り)</Label>
                        <textarea
                          className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                          rows={3}
                          disabled={!isAdmin}
                          value={(q.options ?? []).join("\n")}
                          onChange={(e) =>
                            updateQuestion(idx, {
                              options: e.target.value
                                .split(/\n/)
                                .map((s) => s.trim())
                                .filter(Boolean)
                                .slice(0, 20),
                            })
                          }
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        id={`req-${q.id}`}
                        type="checkbox"
                        checked={q.required}
                        disabled={!isAdmin}
                        onChange={(e) => updateQuestion(idx, { required: e.target.checked })}
                      />
                      <Label htmlFor={`req-${q.id}`} className="text-xs">
                        必須回答
                      </Label>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={idx === 0}
                        onClick={() => move(idx, -1)}
                      >
                        <ArrowUp className="size-3" aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={idx === schema.length - 1}
                        onClick={() => move(idx, 1)}
                      >
                        <ArrowDown className="size-3" aria-hidden />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => removeQuestion(idx)}>
                        <Trash2 className="size-3" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-3">
        {saveMsg && <span className="text-muted-foreground text-xs">{saveMsg}</span>}
        <Button disabled={!isAdmin || saving} onClick={save}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}
