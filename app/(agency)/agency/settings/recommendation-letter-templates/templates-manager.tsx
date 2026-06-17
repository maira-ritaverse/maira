"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RecommendationLetterTemplate } from "@/lib/recommendation-letters/types";

/**
 * 推薦文テンプレート管理 UI
 *
 * email-templates-manager.tsx と同型の「リスト + 編集フォーム」パターン。
 * admin のみ作成 / 編集 / 削除可、advisor は閲覧のみ。
 *
 * フィールド:
 *   - name: テンプレ名(画面選択用)
 *   - prefix_body: 推薦文の冒頭定型句(挨拶など)
 *   - suffix_body: 末尾定型句(組織連絡先など)
 *
 * 編集モードでは name の変更も許可(email-templates は名前固定だが、
 * 推薦文テンプレは「保守の自由度を上げたい」とユーザ要望が出やすいため、
 * 23505(同名衝突)時はサーバ側で 409 に変換される)。
 */
type Props = {
  initialTemplates: RecommendationLetterTemplate[];
  isAdmin: boolean;
};

type Mode = { kind: "none" } | { kind: "create" } | { kind: "edit"; id: string };

export function RecommendationLetterTemplatesManager({ initialTemplates, isAdmin }: Props) {
  const [templates, setTemplates] = useState<RecommendationLetterTemplate[]>(initialTemplates);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [name, setName] = useState("");
  const [prefixBody, setPrefixBody] = useState("");
  const [suffixBody, setSuffixBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setPrefixBody("");
    setSuffixBody("");
    setError(null);
    setMessage(null);
  };

  const openCreate = () => {
    setMode({ kind: "create" });
    reset();
  };

  const openEdit = (t: RecommendationLetterTemplate) => {
    setMode({ kind: "edit", id: t.id });
    setName(t.name);
    setPrefixBody(t.prefixBody);
    setSuffixBody(t.suffixBody);
    setError(null);
    setMessage(null);
  };

  const cancel = () => {
    setMode({ kind: "none" });
    reset();
  };

  const save = async () => {
    if (!name.trim()) {
      setError("テンプレート名を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (mode.kind === "create") {
        const res = await fetch("/api/agency/recommendation-letter-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            prefix_body: prefixBody,
            suffix_body: suffixBody,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          template?: RecommendationLetterTemplate;
          error?: string;
        };
        if (!res.ok || !json.template) throw new Error(json.error ?? `HTTP ${res.status}`);
        setTemplates((prev) => [json.template!, ...prev]);
        setMessage("テンプレートを作成しました");
        setMode({ kind: "none" });
        reset();
      } else if (mode.kind === "edit") {
        const res = await fetch(`/api/agency/recommendation-letter-templates/${mode.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            prefix_body: prefixBody,
            suffix_body: suffixBody,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          template?: RecommendationLetterTemplate;
          error?: string;
        };
        if (!res.ok || !json.template) throw new Error(json.error ?? `HTTP ${res.status}`);
        setTemplates((prev) => prev.map((t) => (t.id === mode.id ? json.template! : t)));
        setMessage("テンプレートを更新しました");
        setMode({ kind: "none" });
        reset();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("このテンプレートを削除しますか?(元に戻せません)")) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/agency/recommendation-letter-templates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setMessage("テンプレートを削除しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {isAdmin && mode.kind === "none" && (
        <Button type="button" onClick={openCreate} size="sm">
          + 新規テンプレート
        </Button>
      )}

      {(mode.kind === "create" || mode.kind === "edit") && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-medium">
            {mode.kind === "create" ? "新規テンプレート" : "テンプレート編集"}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="tmpl-name" className="text-xs">
              テンプレート名 <span className="text-red-600">*</span>
            </Label>
            <Input
              id="tmpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              maxLength={100}
              placeholder="例: 標準フォーマット / マネージャー候補向け"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tmpl-prefix" className="text-xs">
              冒頭定型句(prefix)
            </Label>
            <textarea
              id="tmpl-prefix"
              value={prefixBody}
              onChange={(e) => setPrefixBody(e.target.value)}
              disabled={submitting}
              rows={4}
              maxLength={2000}
              placeholder="例: 拝啓 平素より大変お世話になっております。…"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <p className="text-muted-foreground text-[10px]">{prefixBody.length} / 2000 文字</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tmpl-suffix" className="text-xs">
              末尾定型句(suffix)
            </Label>
            <textarea
              id="tmpl-suffix"
              value={suffixBody}
              onChange={(e) => setSuffixBody(e.target.value)}
              disabled={submitting}
              rows={4}
              maxLength={2000}
              placeholder="例: 敬具
○○エージェント株式会社
担当:山田太郎 / 連絡先:…"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <p className="text-muted-foreground text-[10px]">{suffixBody.length} / 2000 文字</p>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={submitting} size="sm">
              {submitting ? "保存中..." : "保存"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={cancel}
              disabled={submitting}
              size="sm"
            >
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      {templates.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          まだテンプレートがありません。
          {isAdmin
            ? "「新規テンプレート」から最初の 1 件を作成してください。"
            : "管理者にテンプレートの作成を依頼してください。"}
        </Card>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t.name}</p>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(t)}
                        disabled={submitting}
                      >
                        編集
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => remove(t.id)}
                        disabled={submitting}
                      >
                        削除
                      </Button>
                    </div>
                  )}
                </div>
                <details className="text-muted-foreground text-xs">
                  <summary className="cursor-pointer">定型句を表示</summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="text-foreground font-medium">冒頭(prefix)</p>
                      <pre className="bg-muted/40 mt-1 rounded-md p-2 text-xs whitespace-pre-wrap">
                        {t.prefixBody || "(空)"}
                      </pre>
                    </div>
                    <div>
                      <p className="text-foreground font-medium">末尾(suffix)</p>
                      <pre className="bg-muted/40 mt-1 rounded-md p-2 text-xs whitespace-pre-wrap">
                        {t.suffixBody || "(空)"}
                      </pre>
                    </div>
                  </div>
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
