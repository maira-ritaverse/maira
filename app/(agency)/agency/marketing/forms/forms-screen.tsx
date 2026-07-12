"use client";

/**
 * フォーム一覧の Client 部分。
 * 新規作成 / 削除 / 公開切替をここで扱う。編集は /agency/marketing/forms/[id]/edit へ遷移。
 */
import { Copy, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormRow = {
  id: string;
  title: string;
  description: string | null;
  public_token: string;
  is_published: boolean;
  schema_json: Array<{ id: string; kind: string; label: string; required: boolean }>;
  updated_at: string;
};

type Props = {
  initialForms: FormRow[];
  isAdmin: boolean;
};

export function FormsScreen({ initialForms, isAdmin }: Props) {
  const router = useRouter();
  const [forms, setForms] = useState<FormRow[]>(initialForms);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function refetch() {
    startTransition(async () => {
      const res = await fetch("/api/agency/forms", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { forms: FormRow[] };
        setForms(json.forms);
      }
    });
  }

  async function create() {
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "作成に失敗しました");
        return;
      }
      const json = (await res.json()) as { id: string };
      setNewTitle("");
      router.push(`/agency/marketing/forms/${json.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function togglePublish(form: FormRow) {
    const next = !form.is_published;
    setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, is_published: next } : f)));
    const res = await fetch(`/api/agency/forms/${form.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_published: next }),
    });
    if (!res.ok) {
      setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, is_published: !next } : f)));
    }
  }

  async function remove(form: FormRow) {
    if (!window.confirm(`「${form.title}」を削除します。送信履歴も一緒に消えます。よろしいですか?`))
      return;
    const res = await fetch(`/api/agency/forms/${form.id}`, { method: "DELETE" });
    if (res.ok) await refetch();
  }

  function copyPublicUrl(token: string) {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/mf/${token}`;
    void navigator.clipboard.writeText(url);
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">新しいフォーム</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="new-form-title">フォーム名</Label>
                <Input
                  id="new-form-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="ヒアリングシート / お問い合わせ など"
                  maxLength={200}
                />
              </div>
              <Button onClick={create} disabled={creating || !newTitle.trim()}>
                {creating ? "作成中..." : "作成して編集"}
              </Button>
            </div>
            {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
          </CardContent>
        </Card>
      )}

      {forms.length === 0 ? (
        <EmptyState
          title="まだフォームがありません"
          description={
            isAdmin
              ? "上の「作成して編集」から始めてください。"
              : "管理者が作成するとここに表示されます。"
          }
        />
      ) : (
        <div className="space-y-2">
          {forms.map((form) => (
            <Card key={form.id}>
              <CardContent className="flex items-center gap-3 py-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/agency/marketing/forms/${form.id}/edit`}
                      className="text-primary text-sm font-medium hover:underline"
                    >
                      {form.title}
                    </Link>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        form.is_published
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {form.is_published ? "公開中" : "非公開"}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    質問 {form.schema_json.length} 件
                    {form.description ? ` / ${form.description}` : ""}
                  </div>
                </div>
                {form.is_published && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      title="公開 URL をコピー"
                      onClick={() => copyPublicUrl(form.public_token)}
                    >
                      <Copy className="size-3" aria-hidden />
                    </Button>
                    <Link
                      href={`/mf/${form.public_token}`}
                      target="_blank"
                      className="text-muted-foreground hover:text-primary rounded border px-2 py-1 text-xs"
                    >
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  </>
                )}
                {isAdmin && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => togglePublish(form)}>
                      {form.is_published ? "非公開にする" : "公開する"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => remove(form)} title="削除">
                      <Trash2 className="size-3" aria-hidden />
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
