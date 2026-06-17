"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/admin/toast/store";
import { usePersistedState } from "@/lib/admin/use-persisted-state";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type OrgStatus = "active" | "dormant" | "no_admin";

type OrgRow = {
  id: string;
  name: string;
  createdAt: string;
  archivedAt: string | null;
  archivedReason: string | null;
  memberCount: number;
  adminCount: number;
  advisorCount: number;
  clientCount: number;
  linkedClientCount: number;
  lastMemberAt: string | null;
  status: OrgStatus;
};

type SortKey =
  | "name"
  | "createdAt"
  | "adminCount"
  | "advisorCount"
  | "clientCount"
  | "linkedClientCount"
  | "status";
type SortDir = "asc" | "desc";

/** ステータスの並び順:アラート寄りを優先(運営が対応必要な順)。 */
const STATUS_ORDER: Record<OrgStatus, number> = {
  no_admin: 0,
  dormant: 1,
  active: 2,
};

type ListResponse = {
  organizations: OrgRow[];
  total: number;
};

/** 並べ替え判定:string と number と OrgStatus を統一して扱う。 */
function compareOrgs(a: OrgRow, b: OrgRow, key: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  if (key === "name") return a.name.localeCompare(b.name, "ja") * sign;
  if (key === "createdAt") {
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * sign;
  }
  if (key === "status") {
    return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * sign;
  }
  // 残りは数値カラム
  return ((a[key] as number) - (b[key] as number)) * sign;
}

/**
 * 組織一覧テーブル(現役 / 退会済を archived プロップで切替)。
 *
 * アーカイブ操作は物理削除を行わず archived_at に時刻を入れる方式。
 * 復活時は archived_at = null に戻す。
 */
export function OrganizationsTable({ archived }: { archived: boolean }) {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  // ソート状態を localStorage に永続化(画面遷移後も復元)
  const [sortKey, setSortKey] = usePersistedState<SortKey>("admin-orgs-sortKey", "createdAt");
  const [sortDir, setSortDir] = usePersistedState<SortDir>("admin-orgs-sortDir", "desc");
  const { showToast } = useToast();

  const fetchOrgs = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = archived ? "?archived=true" : "";
      const res = await apiFetch<ListResponse>(`/api/admin/organizations${qs}`);
      setOrgs(res?.organizations ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // archived タブの切替を検知して再取得。didLoadRef は使わない
  // (初回マウントで実行 + archived 切替時にも再実行したいため)。
  const lastTabRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastTabRef.current === archived) return;
    lastTabRef.current = archived;
    void fetchOrgs();
    // fetchOrgs は archived に閉じている。依存に入れると毎回再実行されてしまうので意図的に省略。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived]);

  const sortedOrgs = useMemo(() => {
    return [...orgs].sort((a, b) => compareOrgs(a, b, sortKey, sortDir));
  }, [orgs, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      // 数値系は降順から(多い順を見たいケースが多い)、文字列は昇順から
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const handleArchive = async (target: OrgRow) => {
    const reason = window.prompt(
      `「${target.name}」を退会済にします。\nメンバー / クライアント / 求人は履歴として残ります。\n\n理由(任意・最大 500 文字):`,
      "",
    );
    if (reason === null) return;
    setActingId(target.id);
    try {
      await apiFetch(`/api/admin/organizations/${target.id}`, {
        method: "PATCH",
        json: { action: "archive", reason: reason || undefined },
      });
      setOrgs((prev) => prev.filter((o) => o.id !== target.id));
      showToast("success", `${target.name} を退会済に移動しました`);
    } catch (err) {
      showToast("error", `アーカイブ失敗:${getErrorMessage(err)}`);
    } finally {
      setActingId(null);
    }
  };

  const handleUnarchive = async (target: OrgRow) => {
    if (!confirm(`「${target.name}」を現役に戻します。よろしいですか?`)) return;
    setActingId(target.id);
    try {
      await apiFetch(`/api/admin/organizations/${target.id}`, {
        method: "PATCH",
        json: { action: "unarchive" },
      });
      setOrgs((prev) => prev.filter((o) => o.id !== target.id));
      showToast("success", `${target.name} を現役に戻しました`);
    } catch (err) {
      showToast("error", `復活失敗:${getErrorMessage(err)}`);
    } finally {
      setActingId(null);
    }
  };

  // 完全削除(物理削除):退会済タブからのみ実行可。
  // 誤操作防止に企業名のタイプ入力を要求する二段階確認。
  const handleHardDelete = async (target: OrgRow) => {
    const typed = window.prompt(
      `「${target.name}」を完全削除します。\n\n` +
        `この操作は取り消せません。所属メンバーのアカウントは残りますが、` +
        `クライアント / 求人 / 紹介 / 面談 / 通知などの全データが連鎖削除されます。\n\n` +
        `実行するには企業名を正確に入力してください:`,
      "",
    );
    if (typed === null) return;
    if (typed.trim() !== target.name) {
      showToast("error", "企業名が一致しなかったため中止しました");
      return;
    }
    setActingId(target.id);
    try {
      await apiFetch(`/api/admin/organizations/${target.id}`, { method: "DELETE" });
      setOrgs((prev) => prev.filter((o) => o.id !== target.id));
      showToast("success", `${target.name} を完全削除しました`);
    } catch (err) {
      showToast("error", `削除失敗:${getErrorMessage(err)}`);
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return <p className="text-muted-foreground text-sm">読み込み中…</p>;
  }
  if (error) {
    return <p className="text-destructive text-xs">{error}</p>;
  }
  if (orgs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {archived ? "退会済の企業はありません。" : "登録されている組織がありません。"}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground text-xs">{orgs.length} 件</p>
        <RefreshButton onClick={() => void fetchOrgs()} loading={loading} />
      </div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10 text-xs">
            <tr>
              <SortHeader
                k="name"
                label="企業名"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              <SortHeader
                k="createdAt"
                label="作成日"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              {archived && <th className="px-3 py-2.5">退会日</th>}
              {archived && <th className="px-3 py-2.5">理由</th>}
              {!archived && (
                <>
                  <SortHeader
                    k="adminCount"
                    label="admin"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    k="advisorCount"
                    label="advisor"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    k="clientCount"
                    label="求職者(client)"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    k="linkedClientCount"
                    label="うち連携済"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    k="status"
                    label="状態"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                  />
                </>
              )}
              <th className="px-3 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedOrgs.map((o) => (
              <tr
                key={o.id}
                className="hover:bg-accent/40 odd:bg-muted/10 border-t transition-colors"
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium">{o.name}</div>
                  <div className="text-muted-foreground text-[10px]">{o.id}</div>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {new Date(o.createdAt).toLocaleDateString("ja-JP")}
                </td>
                {archived && (
                  <td className="px-3 py-2.5 text-xs">
                    {o.archivedAt ? new Date(o.archivedAt).toLocaleDateString("ja-JP") : "—"}
                  </td>
                )}
                {archived && (
                  <td
                    className="max-w-60 truncate px-3 py-2.5 text-xs"
                    title={o.archivedReason ?? ""}
                  >
                    {o.archivedReason || "—"}
                  </td>
                )}
                {!archived && (
                  <>
                    <td className="px-3 py-2.5 text-right text-xs">{o.adminCount}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-semibold">
                      {o.advisorCount}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-semibold">
                      {o.clientCount}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs">
                      {o.linkedClientCount}
                      {o.clientCount > 0 && (
                        <span className="text-muted-foreground ml-1 text-[10px]">
                          ({Math.round((o.linkedClientCount / o.clientCount) * 100)}%)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={o.status} />
                    </td>
                  </>
                )}
                <td className="px-3 py-2.5 text-right">
                  <div className="inline-flex items-center gap-2">
                    <Link
                      href={`/admin/organizations/${o.id}`}
                      className="text-foreground text-xs font-medium hover:underline"
                    >
                      詳細
                    </Link>
                    {archived ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleUnarchive(o)}
                          disabled={actingId !== null}
                        >
                          {actingId === o.id ? "復活中…" : "復活"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleHardDelete(o)}
                          disabled={actingId !== null}
                        >
                          {actingId === o.id ? "削除中…" : "完全削除"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleArchive(o)}
                        disabled={actingId !== null}
                      >
                        {actingId === o.id ? "処理中…" : "退会済へ"}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  k,
  label,
  sortKey,
  sortDir,
  onClick,
  align = "left",
}: {
  k: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${
          active ? "text-foreground font-semibold" : "hover:text-foreground"
        }`}
      >
        <span>{label}</span>
        <span aria-hidden className="text-[9px]">
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function StatusBadge({ status }: { status: OrgStatus }) {
  if (status === "no_admin") {
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-900 dark:bg-red-950/40 dark:text-red-200">
        admin 不在
      </span>
    );
  }
  if (status === "dormant") {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        休眠の可能性
      </span>
    );
  }
  return (
    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
      稼働中
    </span>
  );
}
