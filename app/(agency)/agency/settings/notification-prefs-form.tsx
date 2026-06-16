"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  NOTIFICATION_DESCRIPTION,
  NOTIFICATION_LABEL,
  type NotificationKey,
  type NotificationPrefs,
} from "@/lib/notifications/prefs";

type Props = {
  initialPrefs: NotificationPrefs;
};

const KEYS: NotificationKey[] = ["referral_status_change", "task_assigned", "client_silent_30d"];

/**
 * 通知購読設定フォーム
 *
 * 現状は ON/OFF のみ。チャンネル(in-app / メール / Slack)別の細分化は将来。
 * 未指定 / 空オブジェクトは全 ON 扱い(prefs.ts の isSubscribed)。
 * UI 上は明示的に true/false の状態を表す:isSubscribed の挙動を写す。
 */
export function NotificationPrefsForm({ initialPrefs }: Props) {
  // 表示用に true/false にフォールバックして初期化(未指定は購読中)
  const [prefs, setPrefs] = useState<Record<NotificationKey, boolean>>({
    referral_status_change: initialPrefs.referral_status_change ?? true,
    seeker_job_interest: initialPrefs.seeker_job_interest ?? true,
    seeker_application_request: initialPrefs.seeker_application_request ?? true,
    task_assigned: initialPrefs.task_assigned ?? true,
    client_silent_30d: initialPrefs.client_silent_30d ?? true,
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
        body: JSON.stringify(prefs),
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
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-semibold">通知設定</h2>
      <ul className="space-y-3">
        {KEYS.map((key) => {
          const isOn = prefs[key];
          return (
            <li key={key} className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium">{NOTIFICATION_LABEL[key]}</div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {NOTIFICATION_DESCRIPTION[key]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(key)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  isOn ? "bg-primary" : "bg-muted"
                }`}
                role="switch"
                aria-checked={isOn}
                aria-label={NOTIFICATION_LABEL[key]}
              >
                <span
                  className={`absolute top-0.5 left-0.5 inline-block size-5 rounded-full bg-white shadow transition-transform ${
                    isOn ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>

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
