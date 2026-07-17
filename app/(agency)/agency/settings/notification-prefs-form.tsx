"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

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
 *   1)「メール通知全体」マスタースイッチ(email_enabled)
 *      OFF にすると種類別が ON でもメールは一切送られなくなる。
 *      アプリ内通知は引き続き受け取る。
 *   2) 種類別 ON/OFF(NotificationKey)
 *      OFF にした種類はメール / アプリ内通知共に抑制される。
 *
 * 招待 / パスワードリセット / 面談招待等のトランザクションメールは
 * この設定の対象外(= 必ず送られる)。
 *
 * 未指定 / 空オブジェクトは全 ON 扱い(prefs.ts の isSubscribed / isEmailEnabled)。
 *
 * 折り畳み:
 *   ヘッダー クリック で 開閉 できる。 状態 は localStorage に 保存 して
 *   次回 訪問 時 も 維持 (毎回 閉じ直す 手間 を 避ける)。 初期 表示 は 開いた
 *   状態 (新規 ユーザー が 通知 設定 の 存在 に 気づく ため)。
 */

const COLLAPSE_STORAGE_KEY = "maira.settings.notificationPrefs.collapsed";
export function NotificationPrefsForm({ initialPrefs }: Props) {
  // 表示用に true/false へフォールバックして初期化(未指定 = ON)
  const [emailEnabled, setEmailEnabled] = useState<boolean>(initialPrefs.email_enabled ?? true);
  const [prefs, setPrefs] = useState<Record<NotificationKey, boolean>>({
    referral_status_change: initialPrefs.referral_status_change ?? true,
    seeker_job_interest: initialPrefs.seeker_job_interest ?? true,
    seeker_application_request: initialPrefs.seeker_application_request ?? true,
    task_assigned: initialPrefs.task_assigned ?? true,
    client_silent_30d: initialPrefs.client_silent_30d ?? true,
    line_message_received: initialPrefs.line_message_received ?? true,
    daily_digest: initialPrefs.daily_digest ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 折り畳み状態。 SSR / 初回 hydration との mismatch を避けるため、 SSR 側は
  // 常に「開いた」状態でレンダリングし、mount 後に localStorage を読んで反映。
  // これで hydration エラーは出ず、次回訪問時の状態も維持できる。
  //
  // eslint-disable-next-line: このパターンは client-only storage を SSR safe に
  // 読み出すための意図的な useEffect setState (初回のみ)。 lint の
  // react-hooks/set-state-in-effect は本来避けるべきパターンだが、ここでは
  // localStorage の副作用を hydration 後に一度だけ反映する目的で使う。
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "1") setCollapsed(true);
    } catch {
      // localStorage が使えない環境(プライベートブラウジングの制限等)は無視
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 保存失敗は無視(次回訪問時の維持ができないだけ、機能は動く)
      }
      return next;
    });
  };

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
    <Card className={collapsed ? "p-4" : "space-y-5 p-5"}>
      {/*
        ヘッダー全体をボタンにして、どこをクリックしても開閉できる。
        aria-expanded で screen reader にも状態を伝える。
      */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls="notification-prefs-body"
        className="hover:bg-accent/40 -m-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md p-2 text-left transition-colors"
      >
        <div className="flex-1 space-y-1">
          <h2 className="text-lg font-semibold">通知設定</h2>
          {!collapsed && (
            <p className="text-muted-foreground text-xs">
              メールとアプリ内通知の受信設定を変更できます。招待 / パスワードリセット /
              面談招待等の業務上必須なメールは本設定の影響を受けません。
            </p>
          )}
        </div>
        <span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
          {collapsed ? <ChevronDown className="size-5" /> : <ChevronUp className="size-5" />}
        </span>
      </button>

      {!collapsed && (
        <div id="notification-prefs-body" className="space-y-5">
          {/* メール全体マスター */}
          <div className="bg-muted/30 flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="flex-1">
              <div className="text-sm font-medium">メール通知を受け取る</div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                OFF にすると、種類別設定が ON であってもメールは一切送られません。アプリ内通知
                (右上のベル)は引き続き受け取れます。
              </p>
            </div>
            <ToggleSwitch
              on={emailEnabled}
              onToggle={() => setEmailEnabled((v) => !v)}
              label="メール通知全体 ON/OFF"
            />
          </div>

          {/* 種類別 */}
          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold">通知する種類</h3>
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
        </div>
      )}
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
