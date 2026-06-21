"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  NOTIFICATION_DESCRIPTION,
  NOTIFICATION_DISPLAY_ORDER,
  NOTIFICATION_LABEL,
  type NotificationKey,
  type NotificationPrefs,
} from "@/lib/notifications/prefs";

type Props = {
  initialPrefs: NotificationPrefs;
};

/**
 * 通知購読設定フォーム
 *
 * 構成:
 *   1) 「メール 通知 全体」 マスター スイッチ (email_enabled)
 *      OFF に する と 種類 別 が ON でも メール は 一切 送られなく なる。
 *      アプリ 内 通知 は 引き続き 受け取る。
 *   2) 種類 別 ON/OFF (NotificationKey)
 *      OFF に した 種類 は メール / アプリ 内 通知 共に 抑制 さ れる。
 *
 * 招待 / パスワード リセット / 面談 招待 等 の トランザクション メール は
 * この 設定 の 対象 外 (= 必ず 送られる)。
 *
 * 未指定 / 空オブジェクトは 全 ON 扱い (prefs.ts の isSubscribed / isEmailEnabled)。
 */
export function NotificationPrefsForm({ initialPrefs }: Props) {
  // 表示用 に true/false へ フォールバック して 初期化 (未指定 = ON)
  const [emailEnabled, setEmailEnabled] = useState<boolean>(initialPrefs.email_enabled ?? true);
  const [prefs, setPrefs] = useState<Record<NotificationKey, boolean>>({
    referral_status_change: initialPrefs.referral_status_change ?? true,
    seeker_job_interest: initialPrefs.seeker_job_interest ?? true,
    seeker_application_request: initialPrefs.seeker_application_request ?? true,
    task_assigned: initialPrefs.task_assigned ?? true,
    client_silent_30d: initialPrefs.client_silent_30d ?? true,
    line_message_received: initialPrefs.line_message_received ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: NotificationKey) => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/agency/me/notification-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...prefs, email_enabled: emailEnabled }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">通知設定</h2>
        <p className="text-muted-foreground text-xs">
          メール と アプリ 内 通知 の 受信 設定 を 変更 でき ます。 招待 / パスワード リセット /
          面談 招待 等 の 業務 上 必須 な メール は 本 設定 の 影響 を 受け ません。
        </p>
      </div>

      {/* メール 全体 マスター */}
      <div className="bg-muted/30 flex items-start justify-between gap-3 rounded-md border p-3">
        <div className="flex-1">
          <div className="text-sm font-medium">メール 通知 を 受け取る</div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            OFF に する と、 種類 別 設定 が ON で あって も メール は 一切 送られ ません。 アプリ
            内 通知 (右上 の ベル) は 引き続き 受け取れ ます。
          </p>
        </div>
        <ToggleSwitch
          on={emailEnabled}
          onToggle={() => setEmailEnabled((v) => !v)}
          label="メール 通知 全体 ON/OFF"
        />
      </div>

      {/* 種類 別 */}
      <div>
        <h3 className="text-muted-foreground mb-2 text-xs font-semibold">通知 する 種類</h3>
        <ul className="divide-border divide-y rounded-md border">
          {NOTIFICATION_DISPLAY_ORDER.map((key) => {
            const isOn = prefs[key];
            return (
              <li key={key} className="flex items-start justify-between gap-3 px-3 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{NOTIFICATION_LABEL[key]}</div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {NOTIFICATION_DESCRIPTION[key]}
                  </p>
                </div>
                <ToggleSwitch
                  on={isOn}
                  onToggle={() => toggle(key)}
                  label={NOTIFICATION_LABEL[key]}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
        {message && (
          <span className="text-xs text-emerald-600 dark:text-emerald-300">{message}</span>
        )}
        {error && <span className="text-xs text-red-600 dark:text-red-300">{error}</span>}
      </div>
    </Card>
  );
}

function ToggleSwitch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-primary" : "bg-muted"
      }`}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span
        className={`absolute top-0.5 left-0.5 inline-block size-5 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}
