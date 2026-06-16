"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EmailTemplate } from "@/lib/email-templates/templates";

type Props = {
  initialTemplates: EmailTemplate[];
};

/**
 * メールテンプレ一覧 + 新規作成 + 編集 + 削除のオールインワン UI。
 *
 * UX:
 *   - 「新規」ボタン → フォームが開く
 *   - 各テンプレに「編集」「削除」
 *   - 編集中は subject / body のみ変えられる(name の変更は一旦削除して作り直し)
 *   - エラー / 成功メッセージは inline
 */
export function EmailTemplatesManager({ initialTemplates }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>(initialTemplates);
  const [mode, setMode] = useState<
    { kind: "create" } | { kind: "edit"; id: string } | { kind: "none" }
  >({
    kind: "none",
  });
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const openCreate = () => {
    setMode({ kind: "create" });
    setName("");
    setSubject("");
    setBody("");
    setError(null);
    setMessage(null);
  };

  const openEdit = (t: EmailTemplate) => {
    setMode({ kind: "edit", id: t.id });
    setName(t.name);
    setSubject(t.subject);
    setBody(t.body);
    setError(null);
    setMessage(null);
  };

  const cancel = () => {
    setMode({ kind: "none" });
    setError(null);
    setMessage(null);
  };

  const save = async () => {
    if (!subject.trim() || !body.trim() || !name.trim()) {
      setError("名前 / 件名 / 本文をすべて入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (mode.kind === "create") {
        const res = await fetch("/api/agency/email-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, subject, body }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          template?: EmailTemplate;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (json.template) {
          setTemplates((prev) => [json.template!, ...prev]);
        }
        setMessage("作成しました");
        setMode({ kind: "none" });
      } else if (mode.kind === "edit") {
        const res = await fetch(`/api/agency/email-templates/${mode.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, body }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          template?: EmailTemplate;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (json.template) {
          const updated = json.template;
          setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        }
        setMessage("保存しました");
        setMode({ kind: "none" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (t: EmailTemplate) => {
    if (!confirm(`テンプレート「${t.name}」を削除しますか?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/agency/email-templates/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      setMessage(`「${t.name}」を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{templates.length} 件</span>
        <Button size="sm" onClick={openCreate} disabled={mode.kind !== "none"}>
          + 新規テンプレート
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
      {message && <div className="text-xs text-emerald-600 dark:text-emerald-300">{message}</div>}

      {mode.kind !== "none" && (
        <Card className="ring-foreground/15 space-y-3 p-4 ring-1">
          <h2 className="text-sm font-medium">
            {mode.kind === "create" ? "新規テンプレート" : "テンプレート編集"}
          </h2>
          <div className="space-y-2">
            <label htmlFor="t_name" className="text-muted-foreground text-xs">
              名前
            </label>
            <Input
              id="t_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mode.kind === "edit"}
              placeholder="例:初回ご挨拶"
              maxLength={100}
            />
            {mode.kind === "edit" && (
              <p className="text-muted-foreground text-xs">
                名前変更は一度削除して作り直してください。
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="t_subject" className="text-muted-foreground text-xs">
              件名
            </label>
            <Input
              id="t_subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="件名(例:ご登録ありがとうございます)"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="t_body" className="text-muted-foreground text-xs">
              本文
            </label>
            <textarea
              id="t_body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              maxLength={5000}
              className="border-input bg-background w-full rounded-lg border px-3 py-2 font-mono text-sm"
              placeholder="本文({client_name} / {advisor_name} / {organization_name} で差し替え)"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={submitting}>
              {submitting ? "保存中…" : "保存"}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      <ul className="space-y-2">
        {templates.length === 0 && (
          <li className="text-muted-foreground py-6 text-center text-sm">
            まだテンプレートがありません
          </li>
        )}
        {templates.map((t) => (
          <li key={t.id}>
            <Card className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{t.name}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(t)}>
                    編集
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t)}>
                    削除
                  </Button>
                </div>
              </div>
              <div className="text-muted-foreground text-xs">
                <div className="truncate">件名:{t.subject}</div>
                <div className="line-clamp-2 whitespace-pre-wrap">{t.body}</div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
