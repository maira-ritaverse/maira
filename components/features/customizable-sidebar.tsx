"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { NavIcon } from "@/lib/ui/nav-icon";

import { Button } from "@/components/ui/button";
import {
  addGroup,
  deleteGroup,
  hideItem,
  moveItemToGroup,
  moveItemToTopLevel,
  renameGroup,
} from "@/lib/sidebar-layout/operations";
import { loadSidebarLayout, saveSidebarLayout } from "@/lib/sidebar-layout/storage";
import type { ItemDescriptor, SidebarLayout } from "@/lib/sidebar-layout/types";

import { SidebarNavGroup, type SidebarItem } from "./sidebar-nav-group";

type Props = {
  /** localStorage キー(ページ単位でユニーク。例:"maira-agency-sidebar")*/
  storageKey: string;
  /** このページに存在しうる全項目のカタログ */
  availableItems: ReadonlyArray<ItemDescriptor>;
  /** 初期レイアウト(ユーザがカスタムしていない場合) */
  defaultLayout: SidebarLayout;
  /** 表示中ページの判定(href ベース) */
  isActive: (href: string) => boolean;
  /** 任意の追加情報:itemId → バッジ件数 */
  badges?: Record<string, number | undefined>;
  /** サイドバー上部に挿入する要素(ロゴ / 組織名など) */
  header?: ReactNode;
  /** サイドバー下部に挿入する要素 */
  footer?: ReactNode;
  /** data-tour 属性(aside 要素にセットする) */
  asideDataTour?: string;
};

/**
 * カスタマイズ可能なサイドバー。
 *
 * 機能:
 *   - 「📐 サイドバー編集」トグルで編集モードに切替
 *   - 編集モード時:
 *       - 各項目をドラッグして、グループ間 / トップレベル / 非表示 へ移動
 *       - グループ名・アイコンをインライン編集
 *       - 「+ グループを追加」「グループを削除」
 *       - 「初期化」でデフォルトに戻す
 *   - 設定は localStorage に保存
 *   - カタログ変更(機能追加 / 削除)時は自動 merge / prune
 */
export function CustomizableSidebar({
  storageKey,
  availableItems,
  defaultLayout,
  isActive,
  badges,
  header,
  footer,
  asideDataTour,
}: Props) {
  const [layout, setLayout] = useState<SidebarLayout>(defaultLayout);
  const [editing, setEditing] = useState(false);

  // ロード済みの storageKey を state で保持する。
  // state(useRef ではない)にすることで、ロード完了が次のレンダーで反映され
  // 保存 effect が走るため、「ロード前に default で上書き保存してしまう」
  // バグを構造的に防ぐ。
  // storageKey が変わった(例:タブ切替)場合は再ロードして、別タブのデータ
  // を間違ったキーで保存しないようにする。
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // マウント / storageKey 変更で localStorage から復元。
  // localStorage は SSR では参照できない外部状態なので、
  // 同期外部ストアへの初回同期として effect 内で setState するのが正当。
  useEffect(() => {
    if (loadedKey === storageKey) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(loadSidebarLayout(storageKey, defaultLayout, availableItems));
    setLoadedKey(storageKey);
  }, [storageKey, defaultLayout, availableItems, loadedKey]);

  // 変更を永続化(ロード済みの storageKey 配下のときだけ)
  useEffect(() => {
    if (loadedKey !== storageKey) return;
    saveSidebarLayout(storageKey, layout);
  }, [storageKey, layout, loadedKey]);

  const itemMap = useMemo(() => {
    const m = new Map<string, ItemDescriptor>();
    for (const i of availableItems) m.set(i.id, i);
    return m;
  }, [availableItems]);

  // SidebarItem(描画用)に変換
  const toSidebarItem = (itemId: string): SidebarItem | null => {
    const d = itemMap.get(itemId);
    if (!d) return null;
    return {
      href: d.href,
      icon: d.icon,
      label: d.defaultLabel,
      isActive: isActive(d.href),
      dataAttr: d.dataAttr,
      badge: badges?.[itemId],
    };
  };

  // ─── DnD ────────────────────────────────────────────────
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  // ドロップターゲット種別と識別子
  const [hoverTarget, setHoverTarget] = useState<
    { kind: "top" } | { kind: "group"; groupId: string } | { kind: "hidden" } | null
  >(null);

  const handleDragStart = (id: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing) return;
    setDragItemId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (target: typeof hoverTarget) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !dragItemId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHoverTarget(target);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !dragItemId || !hoverTarget) return;
    e.preventDefault();
    if (hoverTarget.kind === "top") {
      setLayout((l) => moveItemToTopLevel(l, dragItemId));
    } else if (hoverTarget.kind === "group") {
      setLayout((l) => moveItemToGroup(l, dragItemId, hoverTarget.groupId));
    } else if (hoverTarget.kind === "hidden") {
      setLayout((l) => hideItem(l, dragItemId));
    }
    setDragItemId(null);
    setHoverTarget(null);
  };
  const handleDragEnd = () => {
    setDragItemId(null);
    setHoverTarget(null);
  };

  // 編集 actions
  // インラインタイトル編集:編集中の groupId を null 以外にして input を表示する
  const [editingTitleGroupId, setEditingTitleGroupId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");

  const startTitleEdit = (groupId: string, current: string) => {
    setEditingTitleGroupId(groupId);
    setEditingTitleValue(current);
  };
  const commitTitleEdit = () => {
    if (!editingTitleGroupId) return;
    const trimmed = editingTitleValue.trim();
    if (trimmed.length > 0) {
      setLayout((l) => renameGroup(l, editingTitleGroupId, trimmed));
    }
    setEditingTitleGroupId(null);
    setEditingTitleValue("");
  };
  const cancelTitleEdit = () => {
    setEditingTitleGroupId(null);
    setEditingTitleValue("");
  };

  const handleAddGroup = () => {
    // デフォルト名で追加 → 即座にインライン編集モードに入る
    let newGroupId: string | null = null;
    setLayout((l) => {
      const next = addGroup(l, "新しいグループ");
      newGroupId = next.groups[next.groups.length - 1]?.id ?? null;
      return next;
    });
    // setLayout の同期で newGroupId が決まらないケースに備え、effect で拾ってもよいが
    // シンプルに setTimeout で次フレームに編集開始
    setTimeout(() => {
      if (newGroupId) startTitleEdit(newGroupId, "新しいグループ");
    }, 0);
  };
  const handleDeleteGroup = (groupId: string) => {
    if (!confirm("このグループを削除しますか?中の項目はトップレベルに戻ります。")) return;
    setLayout((l) => deleteGroup(l, groupId));
  };
  const handleReset = () => {
    if (!confirm("サイドバーを初期状態に戻しますか?")) return;
    setLayout(defaultLayout);
  };

  // 表示用ラッパ:編集モード時は draggable + ドロップ可視化
  const renderDraggableItem = (itemId: string) => {
    const sb = toSidebarItem(itemId);
    if (!sb) return null;
    return (
      <div
        key={itemId}
        draggable={editing}
        onDragStart={handleDragStart(itemId)}
        onDragEnd={handleDragEnd}
        className={`group/item relative ${
          editing ? "cursor-grab active:cursor-grabbing" : ""
        } ${dragItemId === itemId ? "opacity-40" : ""}`}
      >
        {editing && (
          <span
            className="text-muted-foreground absolute top-1/2 left-1 -translate-y-1/2 text-[10px]"
            aria-hidden
          >
            ⋮⋮
          </span>
        )}
        <Link
          href={sb.href}
          data-tour={sb.dataAttr}
          aria-current={sb.isActive ? "page" : undefined}
          onClick={(e) => {
            if (editing) e.preventDefault();
          }}
          className={`flex items-center gap-3 rounded-md py-2 text-[15px] font-medium transition-colors ${
            editing ? "pr-3 pl-6" : "px-3"
          } ${sb.isActive && !editing ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          <NavIcon name={sb.icon} className="size-4 shrink-0" />
          <span className="flex-1 truncate">{sb.label}</span>
          {sb.badge !== undefined && sb.badge > 0 && (
            <span className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold">
              {sb.badge}
            </span>
          )}
        </Link>
      </div>
    );
  };

  return (
    <aside
      data-tour={asideDataTour}
      className="bg-card hidden w-60 shrink-0 flex-col border-r p-4 md:flex"
      onDrop={handleDrop}
    >
      {header && <div className="mb-4">{header}</div>}

      <nav className="flex-1 space-y-1.5 overflow-y-auto">
        {/* トップレベル:ドロップ受け可能なエリア */}
        <div
          onDragOver={handleDragOver({ kind: "top" })}
          className={`space-y-1 rounded-md ${
            editing && hoverTarget?.kind === "top"
              ? "outline-2 outline-emerald-500 outline-dashed"
              : ""
          }`}
        >
          {layout.topLevelItemIds.map((id) => renderDraggableItem(id))}
        </div>

        {/* 各グループ */}
        {layout.groups.map((g) => {
          const items = g.itemIds
            .map((id) => toSidebarItem(id))
            .filter((x): x is SidebarItem => x !== null);
          return (
            <div
              key={g.id}
              onDragOver={handleDragOver({ kind: "group", groupId: g.id })}
              className={`rounded-md ${
                editing && hoverTarget?.kind === "group" && hoverTarget.groupId === g.id
                  ? "outline-2 outline-emerald-500 outline-dashed"
                  : ""
              }`}
            >
              {editing ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    {editingTitleGroupId === g.id ? (
                      <input
                        type="text"
                        value={editingTitleValue}
                        autoFocus
                        onChange={(e) => setEditingTitleValue(e.target.value)}
                        onBlur={commitTitleEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitTitleEdit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelTitleEdit();
                          }
                        }}
                        maxLength={30}
                        className="border-input bg-background flex-1 rounded border px-2 py-1 text-sm font-semibold"
                        aria-label="グループ名を編集"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startTitleEdit(g.id, g.title)}
                        className="hover:bg-accent/60 text-foreground flex-1 truncate rounded px-1 py-0.5 text-left text-sm font-semibold"
                        title="クリックで名称を編集"
                      >
                        {g.title}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteGroup(g.id)}
                      className="text-destructive shrink-0 text-[10px] underline-offset-2 hover:underline"
                    >
                      削除
                    </button>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-muted-foreground px-3 py-2 text-[11px] italic">
                      ここに項目をドラッグ
                    </p>
                  ) : (
                    <div className="space-y-0.5 pl-2">
                      {g.itemIds.map((id) => renderDraggableItem(id))}
                    </div>
                  )}
                </div>
              ) : (
                <SidebarNavGroup
                  groupId={g.id}
                  storageKeyPrefix={`${storageKey}-group`}
                  title={g.title}
                  items={items}
                />
              )}
            </div>
          );
        })}

        {/* 編集モード時のみ:グループ追加 + 非表示エリア */}
        {editing && (
          <>
            <button
              type="button"
              onClick={handleAddGroup}
              className="border-input hover:bg-accent w-full rounded-md border border-dashed px-3 py-2 text-xs"
            >
              + グループを追加
            </button>

            <div
              onDragOver={handleDragOver({ kind: "hidden" })}
              className={`bg-muted/30 mt-3 space-y-1 rounded-md p-2 ${
                hoverTarget?.kind === "hidden" ? "outline-2 outline-emerald-500 outline-dashed" : ""
              }`}
            >
              <p className="text-muted-foreground text-[11px] font-medium">
                非表示({layout.hiddenItemIds.length})
              </p>
              {layout.hiddenItemIds.length === 0 ? (
                <p className="text-muted-foreground text-[10px] italic">ここにドラッグで非表示</p>
              ) : (
                layout.hiddenItemIds.map((id) => renderDraggableItem(id))
              )}
            </div>
          </>
        )}
      </nav>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          size="sm"
          variant={editing ? "default" : "ghost"}
          onClick={() => setEditing((v) => !v)}
          className="flex-1"
        >
          {editing ? "編集完了" : "サイドバー編集"}
        </Button>
        {editing && (
          <Button size="sm" variant="ghost" onClick={handleReset}>
            初期化
          </Button>
        )}
      </div>

      {footer && <div className="text-muted-foreground mt-2 text-xs">{footer}</div>}
    </aside>
  );
}
