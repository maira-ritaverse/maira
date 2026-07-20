"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/admin/toast/store";
import { usePersistedState } from "@/lib/admin/use-persisted-state";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type OrgStatus = "active" | "dormant" | "no_admin";

type OrgPlan = {
  tier: string;
  cycle: string;
  planStatus: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
};

type OrgRow = {
  id: string;
  name: string;
  createdAt: string;
  archivedAt: string | null;
  archivedReason: string | null;
  // Solo プラン (個人 事業主) の org は true。 法人 (Team 系) は false。
  isPersonal: boolean;
  // 契約 プラン (未 契約 の org は null)
  plan: OrgPlan | null;
  memberCount: number;
  adminCount: number;
  advisorCount: number;
  clientCount: number;
  linkedClientCount: number;
  lastMemberAt: string | null;
  status: OrgStatus;
  aiMonthlyTotal: {
    limit: number;
    notes: string | null;
    isDefault: boolean;
  };
  recordingUploadEnabled: boolean;
};

type KindFilter = "all" | "corporate" | "personal";

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
  // 種別 フィルタ (全 / 法人 / 個人)。 Solo 契約 の 個人 org を 集中 して 見たい
  // 運用 の ため に 分離。
  const [kindFilter, setKindFilter] = usePersistedState<KindFilter>("admin-orgs-kind", "all");
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

  const filteredOrgs = useMemo(() => {
    if (kindFilter === "corporate") return orgs.filter((o) => !o.isPersonal);
    if (kindFilter === "personal") return orgs.filter((o) => o.isPersonal);
    return orgs;
  }, [orgs, kindFilter]);

  const sortedOrgs = useMemo(() => {
    return [...filteredOrgs].sort((a, b) => compareOrgs(a, b, sortKey, sortDir));
  }, [filteredOrgs, sortKey, sortDir]);

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
        `この操作は取り消せません。クライアント / 求人 / 紹介 / 面談 / 通知など、` +
        `この企業に紐づく全データが連鎖削除されます。\n\n` +
        `所属メンバーのアカウント(auth.users)は、他組織に所属していない場合のみ削除されます。` +
        `削除されたメールアドレスは新規登録に再利用できます。\n\n` +
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
      const res = await apiFetch<{ deletedOrphanUserCount?: number }>(
        `/api/admin/organizations/${target.id}`,
        { method: "DELETE" },
      );
      setOrgs((prev) => prev.filter((o) => o.id !== target.id));
      const orphanCount = res?.deletedOrphanUserCount ?? 0;
      const suffix = orphanCount > 0 ? `(メンバー ${orphanCount} 名のアカウントも削除)` : "";
      showToast("success", `${target.name} を完全削除しました${suffix}`);
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          {(["all", "corporate", "personal"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`rounded px-2.5 py-1 transition-colors ${
                kindFilter === k
                  ? "bg-foreground text-background font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k === "all" ? "全種別" : k === "corporate" ? "法人" : "個人 (Solo)"}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">{filteredOrgs.length} 件</p>
        <RefreshButton onClick={() => void fetchOrgs()} loading={loading} />
      </div>
      {filteredOrgs.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {kindFilter === "personal"
            ? "個人 (Solo) の 組織 は ありません。"
            : kindFilter === "corporate"
              ? "法人 の 組織 は ありません。"
              : "該当する組織がありません。"}
        </p>
      )}
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
                  <th className="px-3 py-2.5 text-right">AI 月次上限</th>
                  <th className="px-3 py-2.5 text-center">録音UP</th>
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{o.name}</span>
                    {o.isPersonal && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                        個人
                      </span>
                    )}
                    <TierBadge plan={o.plan} />
                  </div>
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
                    <td className="px-3 py-2.5 text-right">
                      <AiQuotaEditor
                        orgId={o.id}
                        initialLimit={o.aiMonthlyTotal.limit}
                        initialNotes={o.aiMonthlyTotal.notes}
                        isDefault={o.aiMonthlyTotal.isDefault}
                        onSaved={(next) =>
                          setOrgs((prev) =>
                            prev.map((row) =>
                              row.id === o.id ? { ...row, aiMonthlyTotal: next } : row,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <RecordingUploadToggle
                        orgId={o.id}
                        orgName={o.name}
                        enabled={o.recordingUploadEnabled}
                        onSaved={(enabled) =>
                          setOrgs((prev) =>
                            prev.map((row) =>
                              row.id === o.id ? { ...row, recordingUploadEnabled: enabled } : row,
                            ),
                          )
                        }
                      />
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

/**
 * AI 月次総量上限 の インライン編集 セル
 *
 * デフォルト 500 (運営側 設定が ない場合) → クリックで 編集 モード。
 * 数字 + メモ (Pro プラン 等) を 同時 編集 / 保存。空欄で 「既定に 戻す」。
 *
 * 既存 PUT /api/admin/organizations/[id]/ai-quotas を 使用 (total フィールド)。
 */
function AiQuotaEditor({
  orgId,
  initialLimit,
  initialNotes,
  isDefault,
  onSaved,
}: {
  orgId: string;
  initialLimit: number;
  initialNotes: string | null;
  isDefault: boolean;
  onSaved: (next: { limit: number; notes: string | null; isDefault: boolean }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(String(initialLimit));
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const trimmed = limit.trim();
    let parsed: number | null;
    if (trimmed === "") {
      // 空欄 = 既定 (500) に 戻す
      parsed = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > 1_000_000) {
        setError("0〜1,000,000 の 整数 で 入力");
        return;
      }
      parsed = n;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/ai-quotas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotas: [],
          total: {
            monthlyLimit: parsed,
            notes: notes.trim() ? notes.trim() : undefined,
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        total: { monthlyLimit: number; notes: string | null } | null;
      };
      if (data.total) {
        onSaved({ limit: data.total.monthlyLimit, notes: data.total.notes, isDefault: false });
      } else {
        // 既定に 戻った
        onSaved({ limit: 500, notes: null, isDefault: true });
      }
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に 失敗");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="hover:bg-accent group inline-flex flex-col items-end gap-0.5 rounded px-2 py-1 text-xs"
        title="クリックで 編集"
      >
        <span className="font-semibold">{initialLimit.toLocaleString()}</span>
        {initialNotes ? (
          <span className="text-muted-foreground text-[9px]">{initialNotes}</span>
        ) : (
          <span className="text-muted-foreground text-[9px]">{isDefault ? "既定" : "—"}</span>
        )}
      </button>
    );
  }

  return (
    <div className="bg-card flex flex-col items-end gap-1 rounded border p-2">
      <input
        type="number"
        min={0}
        max={1_000_000}
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        placeholder="既定 500"
        disabled={saving}
        className="border-input w-24 rounded border bg-transparent px-1.5 py-0.5 text-right text-xs"
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="プラン名 / メモ"
        maxLength={200}
        disabled={saving}
        className="border-input w-32 rounded border bg-transparent px-1.5 py-0.5 text-right text-[10px]"
      />
      {error && <span className="text-[9px] text-red-600">{error}</span>}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setLimit(String(initialLimit));
            setNotes(initialNotes ?? "");
            setError(null);
          }}
          disabled={saving}
          className="text-muted-foreground hover:text-foreground text-[10px]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-foreground text-background rounded px-2 py-0.5 text-[10px] font-semibold"
        >
          {saving ? "..." : "保存"}
        </button>
      </div>
    </div>
  );
}

/**
 * 録音 アップロード 機能 の on/off トグル (運営 用 インライン)。
 *
 * デフォルト off。 有効 化 時 に 確認 ダイアログ で 「AI コスト が 発生 します」 を 明示。
 * PATCH /api/admin/organizations/[id] { action: "set_recording_upload", enabled }
 */
function RecordingUploadToggle({
  orgId,
  orgName,
  enabled,
  onSaved,
}: {
  orgId: string;
  orgName: string;
  enabled: boolean;
  onSaved: (enabled: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const toggle = async () => {
    const next = !enabled;
    if (next) {
      const ok = confirm(
        `「${orgName}」で 録音 アップロード 機能 を 有効 化 します。\n\n` +
          `AI 転写 + 抽出 の 実 コスト が 発生 します。 続行 しますか?`,
      );
      if (!ok) return;
    } else {
      const ok = confirm(
        `「${orgName}」で 録音 アップロード 機能 を 無効 化 します。 よろしい ですか?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/organizations/${orgId}`, {
        method: "PATCH",
        json: { action: "set_recording_upload", enabled: next },
      });
      onSaved(next);
      showToast("success", `録音アップロードを${next ? "有効化" : "無効化"}しました`);
    } catch (err) {
      showToast("error", `更新失敗: ${getErrorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
        enabled
          ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
      } ${saving ? "opacity-60" : ""}`}
      title={enabled ? "クリックで無効化" : "クリックで有効化"}
    >
      {saving ? "..." : enabled ? "有効" : "無効"}
    </button>
  );
}

/**
 * 契約 プラン の tier / trial 状態 を バッジ 表示。 未 契約 org は null で 何 も 出さ ない。
 */
function TierBadge({ plan }: { plan: OrgPlan | null }) {
  if (!plan) return null;
  const label: Record<string, string> = {
    solo: "Solo",
    solo_pro: "Solo Pro",
    standard: "Standard",
    standard_pro: "Standard + Pro",
    standard_rec: "Standard(旧)",
    standard_premium: "Standard Premium(旧)",
  };
  const tone: Record<string, string> = {
    solo: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
    solo_pro: "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200",
    standard: "bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200",
    standard_pro: "bg-purple-200 text-purple-950 dark:bg-purple-900/40 dark:text-purple-100",
  };
  const isTrial = plan.planStatus === "trialing";
  const isPastDue = plan.planStatus === "past_due";
  const isCanceled = plan.planStatus === "canceled";
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
          tone[plan.tier] ?? "bg-muted text-muted-foreground"
        }`}
      >
        {label[plan.tier] ?? plan.tier}
      </span>
      {isTrial && (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Trial
        </span>
      )}
      {isPastDue && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          課金失敗
        </span>
      )}
      {isCanceled && (
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          解約済
        </span>
      )}
    </span>
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
