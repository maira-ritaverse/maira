"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { IntakeForm } from "@/lib/intake-forms/types";

type Props = {
  initialForms: IntakeForm[];
  siteUrl: string;
};

export function IntakeFormsManager({ initialForms, siteUrl }: Props) {
  const [forms, setForms] = useState<IntakeForm[]>(initialForms);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [entrySite, setEntrySite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/agency/intake-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          entrySite: entrySite.trim() === "" ? null : entrySite.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { form?: IntakeForm; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.form) setForms((prev) => [json.form!, ...prev]);
      setShowCreate(false);
      setName("");
      setEntrySite("");
      setMessage("作成しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (f: IntakeForm) => {
    setError(null);
    try {
      const res = await fetch(`/api/agency/intake-forms/${f.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !f.isActive }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForms((prev) => prev.map((x) => (x.id === f.id ? { ...x, isActive: !f.isActive } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    }
  };

  const remove = async (f: IntakeForm) => {
    if (!confirm(`「${f.name}」を削除しますか?\n削除後は URL からの送信ができなくなります。`)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/agency/intake-forms/${f.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForms((prev) => prev.filter((x) => x.id !== f.id));
      setMessage(`「${f.name}」を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    }
  };

  const copyUrl = async (token: string) => {
    const url = `${siteUrl}/f/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`URL をコピーしました: ${url}`);
    } catch {
      setMessage(url);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{forms.length} 件</span>
        <Button size="sm" onClick={() => setShowCreate(true)} disabled={showCreate}>
          + 新規フォーム
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
      {message && <div className="text-xs text-emerald-600 dark:text-emerald-300">{message}</div>}

      {showCreate && (
        <Card className="space-y-2 p-3">
          <h3 className="text-sm font-medium">新規フォーム</h3>
          <Input
            placeholder="名前(例:自社サイト用)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
          <Input
            placeholder="エントリーサイト(例:HP / リクナビ。空 OK)"
            value={entrySite}
            onChange={(e) => setEntrySite(e.target.value)}
            maxLength={100}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={create} disabled={submitting}>
              {submitting ? "作成中…" : "作成"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                setName("");
                setEntrySite("");
                setError(null);
              }}
            >
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      <ul className="space-y-2">
        {forms.length === 0 && (
          <li className="text-muted-foreground py-6 text-center text-sm">
            まだフォームがありません
          </li>
        )}
        {forms.map((f) => {
          const url = siteUrl ? `${siteUrl}/f/${f.token}` : `/f/${f.token}`;
          return (
            <li key={f.id}>
              <Card className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{f.name}</span>
                      {f.entrySite && (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px]">
                          {f.entrySite}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          f.isActive
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {f.isActive ? "受付中" : "停止中"}
                      </span>
                    </div>
                    <code className="text-muted-foreground mt-1 block truncate text-xs">{url}</code>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => copyUrl(f.token)}>
                      URL コピー
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleActive(f)}>
                      {f.isActive ? "停止" : "再開"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(f)}>
                      削除
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
