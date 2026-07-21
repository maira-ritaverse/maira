"use client";

/**
 * メール送信設定フォーム(BYO Resend)。
 *
 * ・email_from は平文で扱う(送信元は公開情報)
 * ・API キーは入力時のみ扱い、保存後は平文を再取得しない(has_api_key で状態表示)
 * ・削除ボタンで両方クリア可能
 */
import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  initialEmailFrom: string;
  initialHasKey: boolean;
};

export function OrgEmailSettingsForm({ initialEmailFrom, initialHasKey }: Props) {
  const [emailFrom, setEmailFrom] = useState(initialEmailFrom);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(initialHasKey);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const patch: Record<string, string> = {};
      if (emailFrom !== initialEmailFrom) patch.email_from = emailFrom.trim();
      // API キーは「入力があれば送る」= キーを更新したい時だけ入力する
      if (apiKey.trim() !== "") patch.resend_api_key = apiKey.trim();

      if (Object.keys(patch).length === 0) {
        setSaveMsg("変更がありません");
        return;
      }

      const res = await fetch("/api/agency/settings/email", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        const code = body.error ?? "";
        const msg =
          code === "invalid_email_format"
            ? "送信元アドレスの形式が正しくありません。"
            : code === "invalid_api_key_format"
              ? "Resend API キーの形式が正しくありません(re_ で始まる必要があります)。"
              : (body.message ?? code ?? "保存に失敗しました");
        setError(msg);
        return;
      }
      if (apiKey.trim() !== "") setHasKey(true);
      setApiKey("");
      setSaveMsg("保存しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (
      !window.confirm(
        "メール送信設定をクリアします。メール Flow は Myaira の共通環境変数にフォールバックします。よろしいですか?",
      )
    ) {
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/agency/settings/email", { method: "DELETE" });
      if (!res.ok) {
        setError("クリアに失敗しました");
        return;
      }
      setEmailFrom("");
      setApiKey("");
      setHasKey(false);
      setSaveMsg("クリアしました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded border p-4">
      <div className="space-y-1">
        <Label htmlFor="email-from">送信元アドレス</Label>
        <Input
          id="email-from"
          type="email"
          value={emailFrom}
          onChange={(e) => setEmailFrom(e.target.value)}
          placeholder="recruit@abc-agency.co.jp"
          maxLength={200}
        />
        <p className="text-muted-foreground text-xs">
          Resend で verify 済みのドメインに属するアドレスを指定してください。
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="resend-key">Resend API キー</Label>
        <div className="flex items-center gap-2">
          <Input
            id="resend-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? "設定済み(再入力すると上書きされます)" : "re_xxxxxxxxxxxxxxxx"}
            maxLength={200}
          />
          {hasKey && (
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900"
              title="この組織で API キーが暗号化保存されています"
            >
              <CheckCircle2 className="size-3" aria-hidden />
              設定済み
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          <KeyRound className="mr-0.5 inline size-3" aria-hidden />
          セキュリティのため保存後は表示できません。変更したい時のみ入力してください。
        </p>
      </div>

      {saveMsg && (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
          {saveMsg}
        </p>
      )}
      {error && (
        <p className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
          <AlertTriangle className="mr-1 inline size-3" aria-hidden />
          {error}
        </p>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <Button variant="outline" size="sm" disabled={saving} onClick={clearAll}>
          設定をクリア
        </Button>
        <Button disabled={saving} onClick={save}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}
