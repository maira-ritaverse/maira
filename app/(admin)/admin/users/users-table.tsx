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
  archivedAt: string | null;
  archivedReason: string | null;
};

type ListResponse = {
  users: AdminUserRow[];
  total: number;
};

/**
 * 運営者用のユーザ一覧テーブル(現役 / 停止中を archived プロップで切替)。
 *
 * - 検索:メアド部分一致(IME 入力中の連打を防ぐ 300ms debounce)
 * - アーカイブ:profiles.archived_at に時刻を入れる(履歴は残す)
 * - 復活:profiles.archived_at = null に戻す
 */
export function UsersTable({ archived }: { archived: boolean }) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 検索ワードを localStorage に永続化 → 画面遷移後も復元
  const [query, setQuery] = usePersistedState("admin-users-q", "");
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();

  const fetchUsers = async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (archived) params.set("archived", "true");
      const qs = params.toString();
      const res = await apiFetch<ListResponse>(`/api/admin/users${qs ? `?${qs}` : ""}`);
      setUsers(res?.users ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // 永続化された query + archived タブを含めて debounce で取得
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchUsers(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, archived]);

  const handleArchive = async (target: AdminUserRow) => {
    const reason = window.prompt(
      `${target.email || target.id} を停止中に移動します。\n` +
        `auth.users やデータは残り、ログインはできなくなります(運営判断で復活可)。\n\n` +
        `理由(任意・最大 500 文字):`,
      "",
    );
    if (reason === null) return;
    setActingId(target.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${target.id}`, {
        method: "PATCH",
        json: { action: "archive", reason: reason || undefined },
      });
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      showToast("success", `${target.email || target.id} を停止しました`);
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      showToast("error", `停止失敗:${msg}`);
    } finally {
      setActingId(null);
    }
  };

  const handleUnarchive = async (target: AdminUserRow) => {
    if (!confirm(`${target.email || target.id} を現役に戻します。よろしいですか?`)) return;
    setActingId(target.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${target.id}`, {
        method: "PATCH",
        json: { action: "unarchive" },
      });
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      showToast("success", `${target.email || target.id} を現役に戻しました`);
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      showToast("error", `復活失敗:${msg}`);
    } finally {
      setActingId(null);
    }
  };

  // 完全削除(物理削除):停止中タブからのみ実行可。
  // 誤操作防止にメアドのタイプ入力を要求する二段階確認。
  const handleHardDelete = async (target: AdminUserRow) => {
    const expected = target.email || target.id;
    const typed = window.prompt(
      `${expected} を完全削除します。\n\n` +
        `この操作は取り消せません。auth.users / プロフィール / 履歴書 / 応募 / ` +
        `棚卸し / 通知などすべての関連データが連鎖削除されます。\n\n` +
        `実行するにはメールアドレスを正確に入力してください:`,
      "",
    );
    if (typed === null) return;
    if (typed.trim() !== expected) {
      showToast("error", "メールアドレスが一致しなかったため中止しました");
      return;
    }
    setActingId(target.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${target.id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      showToast("success", `${expected} を完全削除しました`);
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      showToast("error", `削除失敗:${msg}`);
    } finally {
      setActingId(null);
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
        <p className="text-muted-foreground text-sm">
          {archived ? "停止中のユーザはいません。" : "該当ユーザがありません。"}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
              <tr>
                <th className="px-3 py-2.5">メアド</th>
                <th className="px-3 py-2.5">種別</th>
                <th className="px-3 py-2.5">作成日</th>
                {archived ? (
                  <>
                    <th className="px-3 py-2.5">停止日</th>
                    <th className="px-3 py-2.5">理由</th>
                  </>
                ) : (
                  <th className="px-3 py-2.5">オンボ</th>
                )}
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
                  {archived ? (
                    <>
                      <td className="px-3 py-2.5 text-xs">
                        {u.archivedAt ? new Date(u.archivedAt).toLocaleDateString("ja-JP") : "—"}
                      </td>
                      <td
                        className="max-w-60 truncate px-3 py-2.5 text-xs"
                        title={u.archivedReason ?? ""}
                      >
                        {u.archivedReason || "—"}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2.5 text-xs">{u.onboardedAt ? "✓" : "—"}</td>
                  )}
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      {archived ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleUnarchive(u)}
                            disabled={actingId !== null}
                          >
                            {actingId === u.id ? "復活中…" : "復活"}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void handleHardDelete(u)}
                            disabled={actingId !== null}
                          >
                            {actingId === u.id ? "削除中…" : "完全削除"}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleArchive(u)}
                          disabled={actingId !== null}
                        >
                          {actingId === u.id ? "処理中…" : "停止する"}
                        </Button>
                      )}
                    </div>
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
