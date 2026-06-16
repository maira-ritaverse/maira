"use client";

import { useEffect, useState } from "react";

import { usePersistedState } from "@/lib/admin/use-persisted-state";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Log = {
  id: string;
  userId: string | null;
  action: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type ListResponse = {
  logs: Log[];
  total: number;
};

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "account_deleted", label: "本人によるアカウント削除" },
  { value: "admin_force_deleted_user", label: "運営による強制削除" },
  { value: "data_exported", label: "本人によるデータエクスポート" },
  { value: "account_export_requested", label: "エクスポート要求" },
  { value: "privacy_policy_accepted", label: "プライバシーポリシー同意" },
  { value: "admin_accessed_user", label: "運営者のユーザ情報閲覧" },
  { value: "login", label: "ログイン" },
  { value: "logout", label: "ログアウト" },
  { value: "password_changed", label: "パスワード変更" },
  { value: "subscription_changed", label: "サブスク変更" },
];

const ACTION_BADGE_CLASS: Record<string, string> = {
  account_deleted: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200",
  admin_force_deleted_user: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200",
  data_exported: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  account_export_requested: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  privacy_policy_accepted:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  admin_accessed_user: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
};

export function AuditLogsTable() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 選択中アクションを永続化(画面遷移後も復元)
  const [action, setAction] = usePersistedState("admin-audit-action", "");

  const fetchLogs = async (a: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = a
        ? `/api/admin/audit-logs?action=${encodeURIComponent(a)}`
        : `/api/admin/audit-logs`;
      const res = await apiFetch<ListResponse>(url);
      setLogs(res?.logs ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // action が永続化値に hydrate されたあと自動で再取得される。
  // microtask 経由で fetch を起動して set-state-in-effect lint を回避。
  useEffect(() => {
    void Promise.resolve().then(() => fetchLogs(action));
  }, [action]);

  // 現在のフィルタ条件でそのまま CSV をダウンロードできるリンクを作る。
  const csvHref =
    action.length > 0
      ? `/api/admin/audit-logs?format=csv&action=${encodeURIComponent(action)}`
      : `/api/admin/audit-logs?format=csv`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="action-filter" className="text-xs font-medium">
          アクション
        </label>
        <select
          id="action-filter"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">{logs.length} 件</p>
        <a
          href={csvHref}
          download
          className="border-input hover:bg-accent ml-auto rounded-md border px-3 py-1.5 text-xs font-medium"
        >
          CSV をダウンロード
        </a>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : logs.length === 0 ? (
        <p className="text-muted-foreground text-sm">該当する監査ログがありません。</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
              <tr>
                <th className="px-3 py-2.5">日時</th>
                <th className="px-3 py-2.5">アクション</th>
                <th className="px-3 py-2.5">ユーザ</th>
                <th className="px-3 py-2.5">IP</th>
                <th className="px-3 py-2.5">詳細</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const meta = (l.metadata ?? {}) as Record<string, unknown>;
                const email = (meta.email as string | undefined) ?? null;
                const targetEmail = (meta.target_email as string | undefined) ?? null;
                const deletedByEmail = (meta.deleted_by_email as string | undefined) ?? null;
                return (
                  <tr
                    key={l.id}
                    className="hover:bg-accent/40 odd:bg-muted/10 border-t align-top transition-colors"
                  >
                    <td className="px-3 py-2.5 font-mono text-[10px]">
                      {new Date(l.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          ACTION_BADGE_CLASS[l.action] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {l.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {l.userId ? (
                        <>
                          <div className="font-mono text-[10px]">{l.userId.slice(0, 8)}…</div>
                          {email && <div>{email}</div>}
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">
                          (削除済 / {email ?? "—"})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px]">{l.ipAddress ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {targetEmail && (
                        <div>
                          対象:<span className="font-semibold">{targetEmail}</span>
                        </div>
                      )}
                      {deletedByEmail && <div>実行:{deletedByEmail}</div>}
                      {Object.keys(meta).length === 0 && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
