"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SlackSettingsSectionProps = {
  /** 現在の Webhook URL(null = 未設定) */
  currentUrl: string | null;
};

/**
 * 組織の Slack Incoming Webhook 設定セクション(admin 専用)。
 *
 * - Webhook URL を保存 / クリアする
 * - 「テスト送信」で実際に Slack に投稿して動作確認できる
 *
 * セキュリティ:
 *   - URL を画面に出すと shoulder surfing のリスクはあるが、admin 限定 + 同 URL を
 *     再入力する手間を避けるため、現状は平文表示する。
 *   - 将来マスク表示(末尾 4 文字以外を *** 化)に切り替える余地あり。
 */
export function SlackSettingsSection({ currentUrl }: SlackSettingsSectionProps) {
  const router = useRouter();
  const [url, setUrl] = useState(currentUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/agency/organization/slack-webhook", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackWebhookUrl: url.trim() === "" ? null : url.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMessage("保存しました");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/agency/organization/slack-webhook/test", {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMessage("テスト送信に成功しました(Slack を確認してください)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Slack 通知</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Incoming Webhook URL を設定すると、応募ステータスの内定 / 入社 / 見送り 等を Slack
          チャンネルに自動投稿します。
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="slack_webhook" className="text-muted-foreground text-xs">
          Webhook URL
        </label>
        <Input
          id="slack_webhook"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className="max-w-2xl"
        />
        <p className="text-muted-foreground text-xs">
          Slack の管理画面で「Incoming Webhooks」アプリを追加し、投稿先チャンネルを 選んで作成した
          URL を貼り付けてください。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={sendTest}
          disabled={testing || !currentUrl || url !== (currentUrl ?? "")}
          title={
            url !== (currentUrl ?? "")
              ? "編集中の URL はまず保存してください"
              : "現在保存されている URL にテスト投稿します"
          }
        >
          {testing ? "送信中…" : "テスト送信"}
        </Button>
        {message && (
          <span className="text-xs text-emerald-600 dark:text-emerald-300">{message}</span>
        )}
        {error && <span className="text-xs text-red-600 dark:text-red-300">{error}</span>}
      </div>
    </section>
  );
}
