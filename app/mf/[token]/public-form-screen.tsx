"use client";

/**
 * 公開フォームの Client 側。認証なしで /api/public/forms/[token]/submit に POST。
 * LINE 内ブラウザから開かれた場合は LIFF SDK で userId が取れる可能性があるが、
 * MVP では扱わない(将来 LIFF 統合時に line_user_id を optional で埋める)。
 */
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Question = {
  id: string;
  kind: "text" | "textarea" | "select";
  label: string;
  required: boolean;
  options?: string[];
};

type Props = {
  token: string;
  title: string;
  description: string | null;
  schema: unknown[];
};

export function PublicFormScreen({ token, title, description, schema }: Props) {
  const questions = schema.filter((q): q is Question => {
    if (!q || typeof q !== "object") return false;
    const obj = q as Record<string, unknown>;
    return (
      typeof obj.id === "string" &&
      typeof obj.label === "string" &&
      typeof obj.kind === "string" &&
      ["text", "textarea", "select"].includes(obj.kind)
    );
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAnswer(qid: string, value: string) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const q of questions) {
      if (q.required && !answers[q.id]?.trim()) {
        setError(`「${q.label}」を入力してください。`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/forms/${token}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "送信に失敗しました");
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-3 rounded border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto size-8 text-emerald-600" aria-hidden />
        <h1 className="text-lg font-semibold text-emerald-900">送信ありがとうございました</h1>
        <p className="text-sm text-emerald-800">担当者から追ってご連絡いたします。</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>

      {questions.length === 0 ? (
        <p className="text-muted-foreground rounded border border-dashed p-4 text-center text-sm">
          このフォームにはまだ質問がありません。
        </p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.id} className="space-y-1">
              <Label htmlFor={`f-${q.id}`}>
                {q.label}
                {q.required && <span className="ml-1 text-rose-600">*</span>}
              </Label>
              {q.kind === "text" && (
                <Input
                  id={`f-${q.id}`}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  required={q.required}
                  maxLength={4000}
                />
              )}
              {q.kind === "textarea" && (
                <textarea
                  id={`f-${q.id}`}
                  className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                  rows={4}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  required={q.required}
                  maxLength={4000}
                />
              )}
              {q.kind === "select" && (q.options ?? []).length > 0 && (
                <select
                  id={`f-${q.id}`}
                  className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  required={q.required}
                >
                  <option value="">選択してください</option>
                  {(q.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded border p-3 text-sm">
          {error}
        </div>
      )}

      <Button type="submit" disabled={submitting || questions.length === 0} className="w-full">
        {submitting ? "送信中..." : "送信する"}
      </Button>
    </form>
  );
}
