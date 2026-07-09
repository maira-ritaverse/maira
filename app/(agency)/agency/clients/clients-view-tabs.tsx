"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  defaultColumnConfig,
  loadColumnConfig,
  saveColumnConfig,
} from "@/lib/clients/column-config";
import type { ClientFiltersJson, SavedView } from "@/lib/saved-views/types";
import {
  clientEmploymentTypeLabels,
  clientStatusLabels,
  type ClientEmploymentType,
  type ClientRecordWithUpdateBadge,
} from "@/lib/clients/types";
import {
  applyClientsFilterSort,
  buildCrmTagOptions,
  buildEmploymentTypeOptions,
  buildEntrySiteOptions,
  buildPrefectureOptions,
  type SilenceFilter,
  type SortColumn,
  type SortDirection,
  type StatusFilter,
} from "@/lib/clients/filter-sort";
import { useNow } from "@/lib/agency-tasks/use-now";

import { BulkActionBar } from "./bulk-action-bar";
import { ClientsKanban } from "./clients-kanban";
import { ClientsTable } from "./clients-table";
import { ColumnConfigModal } from "./column-config-modal";

type ClientsViewTabsProps = {
  clients: ClientRecordWithUpdateBadge[];
  /** 組織メンバー(担当者一括変更のドロップダウン用)。空配列 OK。 */
  members: Array<{ memberId: string; displayName: string | null }>;
  /** 組織 の team 一覧 (P4 - team フィルタ 用)。 空配列 なら team ピッカー を 隠す。 */
  teams?: Array<{ id: string; name: string; color: string | null }>;
  /** client_id → 所属 team_id[] の マップ。 team フィルタ の 判定 に 使う。 */
  clientTeamIdsByClientId?: Record<string, string[]>;
};

type ViewMode = "table" | "kanban";

const VIEW_TABS: Array<{ value: ViewMode; label: string; icon: string }> = [
  { value: "table", label: "テーブル", icon: "▦" },
  { value: "kanban", label: "カンバン", icon: "▤" },
];

/**
 * クライアント一覧のビュー切替コンテナ(テーブル / カンバン)。
 *
 * 設計方針:
 * - フィルタ / ソート状態をここに集約し、両ビューで「絞り込み体験」を共有する。
 *   タブを切り替えてもフィルタは維持される(ユーザーが東京で絞ったまま
 *   カンバンに切替→そのまま東京の人だけが見える)。
 * - applyClientsFilterSort は純関数で副作用ゼロ。テスト済み。
 * - 選択肢(都道府県 / 雇用形態 / エントリーサイト)は **全クライアント** から
 *   集計する(絞り込み後の集計だと「絞り込むほど選択肢が減る」混乱が起きるため)。
 */
// URL の ?silence=<key> から SilenceFilter を取り出す(未知値は "all" にフォールバック)。
// 沈黙アラートカードからの遷移時に初期フィルタとして使う。
const VALID_SILENCE_KEYS: ReadonlySet<SilenceFilter> = new Set([
  "all",
  "14d",
  "30d",
  "60d",
  "90d",
  "never",
] as const);

function parseSilenceFromParam(raw: string | null): SilenceFilter {
  if (!raw) return "all";
  return (VALID_SILENCE_KEYS as Set<string>).has(raw) ? (raw as SilenceFilter) : "all";
}

export function ClientsViewTabs({
  clients,
  members,
  teams = [],
  clientTeamIdsByClientId = {},
}: ClientsViewTabsProps) {
  const searchParams = useSearchParams();
  // URL パラメータ ?silence=30d 等から初期フィルタを決める(沈黙アラートカードからの導線)。
  // 初回マウント時のみ評価したいので useMemo + 初期 state で参照する。
  const initialSilenceFilter = useMemo(
    () => parseSilenceFromParam(searchParams.get("silence")),
    [searchParams],
  );

  const [view, setView] = useState<ViewMode>("table");

  // フィルタ / ソート状態(両ビュー共通)
  const [sortColumn, setSortColumn] = useState<SortColumn>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [entrySiteFilter, setEntrySiteFilter] = useState<string>("all");
  const [prefectureFilter, setPrefectureFilter] = useState<string>("all");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState<string>("all");
  // 沈黙顧客フィルタ(CRM 機能):対応からの経過日数で絞る。URL ?silence= が初期値。
  const [silenceFilter, setSilenceFilter] = useState<SilenceFilter>(initialSilenceFilter);
  // CRM 自由タグフィルタ(AND 条件)。空配列は絞らない。
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // リスト表フィルタ。"all" = 全て、"unassigned" = 未割当のみ、
  //   その他は team_id そのもの (該当リスト表のみ表示)。
  const [teamFilter, setTeamFilter] = useState<string>("all");
  // リスト表が削除されたり teams prop から消えたりした場合、そのフィルタを保持し続けると
  // 「常に0件」の状態になってしまう。derived な effectiveTeamFilter を作って
  // 表示 / フィルタに使い、useEffect + setState の同期を回避する。
  const effectiveTeamFilter = useMemo(() => {
    if (teamFilter === "all" || teamFilter === "unassigned") return teamFilter;
    return teams.some((t) => t.id === teamFilter) ? teamFilter : "all";
  }, [teamFilter, teams]);

  // ─── 列設定(localStorage 永続化、マウント後にロード) ─────────
  // 初期値はデフォルト(SSR と初回 render で order が一致)。
  // マウント直後に localStorage の保存値があれば置き換える。
  const [columnConfig, setColumnConfig] = useState(() => defaultColumnConfig());
  const [columnConfigOpen, setColumnConfigOpen] = useState(false);
  const columnConfigLoadedRef = useRef(false);
  useEffect(() => {
    if (columnConfigLoadedRef.current) return;
    columnConfigLoadedRef.current = true;
    setColumnConfig(loadColumnConfig());
  }, []);
  // 変更があれば永続化(初期マウント時の load 結果上書きを防ぐため、loaded 後だけ save)
  useEffect(() => {
    if (!columnConfigLoadedRef.current) return;
    saveColumnConfig(columnConfig);
  }, [columnConfig]);

  // ─── 一括操作の選択状態(テーブルビューのみ) ─────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // 「ヘッダのチェックボックス」全選択 / 全解除のトグル(filteredSorted を対象)
  const clearSelection = () => setSelectedIds(new Set());

  // 沈黙判定用の現在時刻(SSR と差異が出ないよう useNow 経由)
  const now = useNow();

  // ─── 保存ビュー(マイビュー) ─────────────────────
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [savingView, setSavingView] = useState(false);

  // マウント時に保存ビューを取得(API は GET /api/agency/saved-views?resource=clients)。
  // react-hooks/set-state-in-effect を避けるため、fetch 関数は useEffect 内で定義する
  // (notification-bell と同じパターン)。
  useEffect(() => {
    let cancelled = false;
    const loadViews = async () => {
      // 初回はローディング状態を出す。setState は async fn 内なのでルール対象外。
      setSavedViewsLoading(true);
      setSavedViewsError(null);
      try {
        const res = await fetch("/api/agency/saved-views?resource=clients");
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { views: SavedView[] };
        if (cancelled) return;
        setSavedViews(json.views ?? []);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "不明なエラー";
        setSavedViewsError(`保存ビューの取得に失敗: ${message}`);
      } finally {
        if (!cancelled) setSavedViewsLoading(false);
      }
    };
    void loadViews();
    return () => {
      cancelled = true;
    };
  }, []);

  // 現在のフィルタ状態を ClientFiltersJson 形式に集約(保存時に使う)
  const currentFiltersJson = useMemo<ClientFiltersJson>(
    () => ({
      searchQuery,
      statusFilter,
      entrySiteFilter,
      prefectureFilter,
      employmentTypeFilter,
      silenceFilter,
      tagFilter,
      sortColumn,
      sortDirection,
    }),
    [
      searchQuery,
      statusFilter,
      entrySiteFilter,
      prefectureFilter,
      employmentTypeFilter,
      silenceFilter,
      tagFilter,
      sortColumn,
      sortDirection,
    ],
  );

  // 保存ビューを適用(各 setState を順に呼ぶ。未指定は default に倒す)。
  // active な id は currentFiltersJson から自動派生するので別途持たない。
  const applySavedView = (v: SavedView) => {
    const f = v.filters ?? {};
    setSearchQuery(f.searchQuery ?? "");
    setStatusFilter(f.statusFilter ?? "all");
    setEntrySiteFilter(f.entrySiteFilter ?? "all");
    setPrefectureFilter(f.prefectureFilter ?? "all");
    setEmploymentTypeFilter(f.employmentTypeFilter ?? "all");
    setSilenceFilter(f.silenceFilter ?? "all");
    setTagFilter(f.tagFilter ?? []);
    setSortColumn(f.sortColumn ?? "createdAt");
    setSortDirection(f.sortDirection ?? "desc");
  };

  // 現在のフィルタと一致する保存ビューがあれば、それを「active」とみなす。
  // 派生値なので useState で持たず useMemo で計算。useEffect での setState を回避できる。
  const activeSavedViewId = useMemo(() => {
    const currentJson = JSON.stringify(currentFiltersJson);
    for (const v of savedViews) {
      if (JSON.stringify(v.filters ?? {}) === currentJson) return v.id;
    }
    return null;
  }, [currentFiltersJson, savedViews]);

  const handleSaveView = async () => {
    const name = newViewName.trim();
    if (!name) return;
    setSavingView(true);
    setSavedViewsError(null);
    try {
      const res = await fetch("/api/agency/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "clients",
          name,
          filters: currentFiltersJson,
        }),
      });
      const json = (await res.json()) as { view?: SavedView; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.view) {
        setSavedViews((prev) => [json.view!, ...prev]);
      }
      setShowSaveDialog(false);
      setNewViewName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setSavedViewsError(`保存に失敗: ${message}`);
    } finally {
      setSavingView(false);
    }
  };

  const handleDeleteView = async (id: string) => {
    if (!confirm("このマイビューを削除しますか?")) return;
    setSavedViewsError(null);
    try {
      const res = await fetch(`/api/agency/saved-views/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedViews((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setSavedViewsError(`削除に失敗: ${message}`);
    }
  };

  // 選択肢の集計は元配列(絞り込み前)で行う
  const entrySiteOptions = useMemo(() => buildEntrySiteOptions(clients), [clients]);
  const prefectureOptions = useMemo(() => buildPrefectureOptions(clients), [clients]);
  const employmentTypeOptions = useMemo(() => buildEmploymentTypeOptions(clients), [clients]);
  const crmTagOptions = useMemo(() => buildCrmTagOptions(clients), [clients]);

  const teamFilteredClients = useMemo(() => {
    if (effectiveTeamFilter === "all") return clients;
    if (effectiveTeamFilter === "unassigned") {
      return clients.filter((c) => (clientTeamIdsByClientId[c.id] ?? []).length === 0);
    }
    return clients.filter((c) =>
      (clientTeamIdsByClientId[c.id] ?? []).includes(effectiveTeamFilter),
    );
  }, [clients, clientTeamIdsByClientId, effectiveTeamFilter]);

  const filteredSorted = useMemo(
    () =>
      applyClientsFilterSort(teamFilteredClients, {
        searchQuery,
        statusFilter,
        entrySiteFilter,
        prefectureFilter,
        employmentTypeFilter,
        silenceFilter,
        tagFilter,
        now: now ? now.getTime() : undefined,
        sortColumn,
        sortDirection,
      }),
    [
      teamFilteredClients,
      searchQuery,
      statusFilter,
      entrySiteFilter,
      prefectureFilter,
      employmentTypeFilter,
      silenceFilter,
      tagFilter,
      now,
      sortColumn,
      sortDirection,
    ],
  );

  const toggleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };

  return (
    <div className="space-y-4">
      {/* タブ切替 + 件数 */}
      <div className="flex items-center justify-between">
        <div className="ring-foreground/10 inline-flex rounded-lg ring-1">
          {VIEW_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setView(t.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors first:rounded-l-lg last:rounded-r-lg ${
                view === t.value
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-muted-foreground"
              }`}
              aria-pressed={view === t.value}
            >
              <span aria-hidden>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-sm">{filteredSorted.length}件</span>
      </div>

      {/* リスト表ピッカー(組織にリスト表が1つ以上あれば表示) */}
      {teams.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs whitespace-nowrap">リスト表:</span>
          <button
            type="button"
            onClick={() => setTeamFilter("all")}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              effectiveTeamFilter === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-accent border-input"
            }`}
          >
            すべて
          </button>
          <button
            type="button"
            onClick={() => setTeamFilter("unassigned")}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              effectiveTeamFilter === "unassigned"
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-accent border-input"
            }`}
          >
            未割当
          </button>
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTeamFilter(t.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                effectiveTeamFilter === t.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-accent border-input"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: t.color ?? "#94a3b8" }}
              />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* マイビュー(保存ビュー)バー:現在のフィルタを名前付きで保存 / ロード / 削除 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs whitespace-nowrap">マイビュー:</span>
        {savedViewsLoading ? (
          <span className="text-muted-foreground text-xs">読み込み中…</span>
        ) : savedViews.length === 0 ? (
          <span className="text-muted-foreground text-xs">未保存</span>
        ) : (
          savedViews.map((v) => {
            const isActive = activeSavedViewId === v.id;
            return (
              <span
                key={v.id}
                className={`group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                <button
                  type="button"
                  onClick={() => applySavedView(v)}
                  className="cursor-pointer"
                  title={`ビュー「${v.name}」を適用`}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteView(v.id)}
                  className="opacity-50 hover:opacity-100"
                  aria-label={`ビュー「${v.name}」を削除`}
                  title="削除"
                >
                  ×
                </button>
              </span>
            );
          })
        )}
        <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(true)}>
          現在のフィルタを保存
        </Button>
        {savedViewsError && (
          <span className="text-xs text-red-600 dark:text-red-300">{savedViewsError}</span>
        )}
      </div>

      {/* 保存ダイアログ(インライン展開) */}
      {showSaveDialog && (
        <div className="ring-foreground/10 flex flex-wrap items-center gap-2 rounded-lg p-3 ring-1">
          <Input
            placeholder="ビュー名(例:東京 / 30日以上対応なし)"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            className="max-w-xs"
            maxLength={100}
            autoFocus
          />
          <Button
            size="sm"
            onClick={handleSaveView}
            disabled={savingView || newViewName.trim() === ""}
          >
            {savingView ? "保存中…" : "保存"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowSaveDialog(false);
              setNewViewName("");
            }}
          >
            キャンセル
          </Button>
        </div>
      )}

      {/* 検索・フィルタ行(両ビュー共通) */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="氏名・氏名カナ・メールで検索"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
        >
          <option value="all">すべての対応状況</option>
          {Object.entries(clientStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {entrySiteOptions.length > 0 && (
          <select
            value={entrySiteFilter}
            onChange={(e) => setEntrySiteFilter(e.target.value)}
            className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
          >
            <option value="all">すべての媒体</option>
            {entrySiteOptions.map(([key, count]) => (
              <option key={key} value={key}>
                {key === "unset" ? "未設定" : key}({count})
              </option>
            ))}
          </select>
        )}
        {prefectureOptions.length > 0 && (
          <select
            value={prefectureFilter}
            onChange={(e) => setPrefectureFilter(e.target.value)}
            className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
          >
            <option value="all">すべての都道府県</option>
            {prefectureOptions.map(([key, count]) => (
              <option key={key} value={key}>
                {key === "unset" ? "未設定" : key}({count})
              </option>
            ))}
          </select>
        )}
        {employmentTypeOptions.length > 0 && (
          <select
            value={employmentTypeFilter}
            onChange={(e) => setEmploymentTypeFilter(e.target.value)}
            className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
          >
            <option value="all">すべての雇用形態</option>
            {employmentTypeOptions.map(([key, count]) => {
              const label =
                key === "unset"
                  ? "未設定"
                  : clientEmploymentTypeLabels[key as ClientEmploymentType];
              return (
                <option key={key} value={key}>
                  {label}({count})
                </option>
              );
            })}
          </select>
        )}
        {/* 沈黙顧客フィルタ:対応からの経過日数で絞り込む。
            「14日/30日/60日/90日 以上対応なし」「一度も対応していない」を選べる。
            CRM の「放置されている案件を可視化する」中核機能。 */}
        <select
          value={silenceFilter}
          onChange={(e) => setSilenceFilter(e.target.value as SilenceFilter)}
          className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
          title="対応からの経過日数で絞り込む"
        >
          <option value="all">対応経過(すべて)</option>
          <option value="14d">14日以上対応なし</option>
          <option value="30d">30日以上対応なし</option>
          <option value="60d">60日以上対応なし</option>
          <option value="90d">90日以上対応なし</option>
          <option value="never">一度も対応なし</option>
        </select>
      </div>

      {/* CRM 自由タグ:組織内で実在するタグだけを件数付きでトグル表示。
          複数選択は AND 条件。クリックでオン/オフ。 */}
      {crmTagOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs whitespace-nowrap">タグ:</span>
          {crmTagOptions.map(([tag, count]) => {
            const active = tagFilter.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setTagFilter((prev) =>
                    prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                  )
                }
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
                aria-pressed={active}
              >
                <span>{tag}</span>
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
          {tagFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setTagFilter([])}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              クリア
            </button>
          )}
        </div>
      )}

      {/* ビュー本体 */}
      {view === "table" ? (
        <ClientsTable
          clients={filteredSorted}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onToggleSort={toggleSort}
          columnConfig={columnConfig}
          onColumnConfigChange={setColumnConfig}
          onOpenColumnConfig={() => setColumnConfigOpen(true)}
          selectedIds={selectedIds}
          onToggleSelectId={toggleSelectId}
          onToggleSelectAll={() => {
            // 現在のフィルタ結果が全部選択中なら全解除、それ以外は全選択
            const allSelected =
              filteredSorted.length > 0 && filteredSorted.every((c) => selectedIds.has(c.id));
            if (allSelected) {
              const next = new Set(selectedIds);
              for (const c of filteredSorted) next.delete(c.id);
              setSelectedIds(next);
            } else {
              const next = new Set(selectedIds);
              for (const c of filteredSorted) next.add(c.id);
              setSelectedIds(next);
            }
          }}
        />
      ) : (
        <ClientsKanban clients={filteredSorted} />
      )}

      <ColumnConfigModal
        open={columnConfigOpen}
        config={columnConfig}
        onChange={setColumnConfig}
        onClose={() => setColumnConfigOpen(false)}
      />

      {/* 一括操作バー(選択数が 0 のときは内部で null を返す)。
          テーブルビューでのみ表示する(カンバンは個別ドラッグで完結する設計)。 */}
      {view === "table" && (
        <BulkActionBar
          selectedIds={Array.from(selectedIds)}
          members={members}
          teams={teams}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}
