"use client";

import { useEffect, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/admin/toast/store";
import { usePersistedState } from "@/lib/admin/use-persisted-state";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type AdminUserRow = {
  id: string;
  email: string;
  createdAt: string;
  accountType: string;
  isMairaAdmin: boolean;
  onboardedAt: string | null;
};

type ListResponse = {
  users: AdminUserRow[];
  total: number;
};

/**
 * 運営者用のユーザ一覧テーブル。
 *
 * - 検索:メアド部分一致(IME 入力中の連打を防ぐ 300ms debounce)
 * - 強制削除:確認ダイアログ → DELETE API → 一覧から消す
 * - 表示:メアド / 種別バッジ / 作成日 / オンボード済 / 操作
 */
export function UsersTable() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 検索ワードを localStorage に永続化 → 画面遷移後も復元
  const [query, setQuery] = usePersistedState("admin-users-q", "");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();

  const fetchUsers = async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ListResponse>(
        `/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      );
      setUsers(res?.users ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // 永続化された query を含めて debounce で取得(初回 + 変更時)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchUsers(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleDelete = async (target: AdminUserRow) => {
    if (
      !confirm(
        `${target.email}(${target.id})を完全に削除します。\n` +
          `履歴書 / 応募 / 棚卸し / 通知などすべてのデータが連鎖削除され、元に戻せません。\n\n` +
          `本当に実行しますか?`,
      )
    ) {
      return;
    }
    setDeletingId(target.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${target.id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      showToast("success", `${target.email || target.id} を削除しました`);
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      showToast("error", `削除失敗:${msg}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メールアドレスで検索…"
          className="max-w-sm"
        />
        <p className="text-muted-foreground text-xs">{users.length} 件</p>
        <RefreshButton onClick={() => void fetchUsers(query)} loading={loading} />
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : users.length === 0 ? (
        <p className="text-muted-foreground text-sm">該当ユーザがありません。</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
              <tr>
                <th className="px-3 py-2.5">メアド</th>
                <th className="px-3 py-2.5">種別</th>
                <th className="px-3 py-2.5">作成日</th>
                <th className="px-3 py-2.5">オンボ</th>
                <th className="px-3 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="hover:bg-accent/40 odd:bg-muted/10 border-t transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{u.email || "(no email)"}</div>
                    <div className="text-muted-foreground text-[10px]">{u.id}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <AccountTypeBadge type={u.accountType} />
                      {u.isMairaAdmin && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          運営者
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {new Date(u.createdAt).toLocaleDateString("ja-JP")}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{u.onboardedAt ? "✓" : "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(u)}
                      disabled={deletingId !== null}
                    >
                      {deletingId === u.id ? "削除中…" : "強制削除"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountTypeBadge({ type }: { type: string }) {
  const colorClass =
    type === "organization_member"
      ? "bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200"
      : type === "seeker"
        ? "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${colorClass}`}>{type}</span>
  );
}
