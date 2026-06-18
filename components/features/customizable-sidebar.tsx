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
  //
  // 設計:
  //   ・項目を「コンテナにポイ」だけでなく、項目間にカーソルを置いて
  //     「ここに挿入」できるようにする
  //   ・各項目要素自身が drop zone を兼ね、カーソル Y が item の上半分なら
  //     その項目の前に、下半分なら後ろに挿入位置を立てる
  //   ・コンテナ自体の余白 / 空のとき / 末尾(最後の項目の下)は「末尾追加」
  //   ・移動元と移動先が同じリストの場合、detachItem 後にインデックスが
  //     1 つ詰まるため、ドロップ時に補正する
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  type DropTarget =
    | { kind: "top"; index: number }
    | { kind: "group"; groupId: string; index: number }
    | { kind: "hidden" };
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const handleDragStart = (id: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing) return;
    setDragItemId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  /**
   * 項目要素自身の dragover:カーソル Y を見て「この項目の前 / 後ろ」を判定。
   * @param index 当該項目のレンダー時の index(リスト内位置)
   * @param container どのリスト(top / group)
   */
  const handleItemDragOver =
    (container: { kind: "top" } | { kind: "group"; groupId: string }, index: number) =>
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!editing || !dragItemId) return;
      e.preventDefault();
      e.stopPropagation(); // コンテナの dragover(末尾追加)を打ち消す
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const isBottomHalf = e.clientY - rect.top > rect.height / 2;
      const insertionIndex = isBottomHalf ? index + 1 : index;
      setDropTarget({ ...container, index: insertionIndex });
    };

  /**
   * リストコンテナ(top / group / hidden)の dragover。
   * 子の項目要素で stopPropagation していない場合のみここに来る = 末尾追加。
   */
  const handleContainerDragOver =
    (
      container:
        | { kind: "top"; itemCount: number }
        | { kind: "group"; groupId: string; itemCount: number }
        | { kind: "hidden" },
    ) =>
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!editing || !dragItemId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (container.kind === "hidden") {
        setDropTarget({ kind: "hidden" });
      } else if (container.kind === "top") {
        setDropTarget({ kind: "top", index: container.itemCount });
      } else {
        setDropTarget({
          kind: "group",
          groupId: container.groupId,
          index: container.itemCount,
        });
      }
    };

  /**
   * 移動元が移動先と同じリストの場合、対象配列を detachItem した後に index が
   * 1 つ詰まる(自身が抜けるため)。drop 時に補正する。
   */
  const adjustIndexForSameList = (target: DropTarget): DropTarget => {
    if (!dragItemId) return target;
    if (target.kind === "top") {
      const originalIndex = layout.topLevelItemIds.indexOf(dragItemId);
      if (originalIndex >= 0 && originalIndex < target.index) {
        return { ...target, index: target.index - 1 };
      }
    } else if (target.kind === "group") {
      const group = layout.groups.find((g) => g.id === target.groupId);
      if (group) {
        const originalIndex = group.itemIds.indexOf(dragItemId);
        if (originalIndex >= 0 && originalIndex < target.index) {
          return { ...target, index: target.index - 1 };
        }
      }
    }
    return target;
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !dragItemId || !dropTarget) return;
    e.preventDefault();
    const adjusted = adjustIndexForSameList(dropTarget);
    if (adjusted.kind === "top") {
      setLayout((l) => moveItemToTopLevel(l, dragItemId, adjusted.index));
    } else if (adjusted.kind === "group") {
      setLayout((l) => moveItemToGroup(l, dragItemId, adjusted.groupId, adjusted.index));
    } else if (adjusted.kind === "hidden") {
      setLayout((l) => hideItem(l, dragItemId));
    }
    setDragItemId(null);
    setDropTarget(null);
  };
  const handleDragEnd = () => {
    setDragItemId(null);
    setDropTarget(null);
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

  // 描画用ヘルパー:カーソル位置に応じて、当該項目の上 / 下にハイライト線を出す
  const insertionLineFor = (
    container: { kind: "top" } | { kind: "group"; groupId: string },
    index: number,
  ): "above" | "below" | null => {
    if (!dropTarget) return null;
    if (container.kind === "top" && dropTarget.kind === "top") {
      if (dropTarget.index === index) return "above";
      if (dropTarget.index === index + 1) return "below";
    } else if (
      container.kind === "group" &&
      dropTarget.kind === "group" &&
      dropTarget.groupId === container.groupId
    ) {
      if (dropTarget.index === index) return "above";
      if (dropTarget.index === index + 1) return "below";
    }
    return null;
  };

  // 表示用ラッパ:編集モード時は draggable + ドロップ可視化
  const renderDraggableItem = (
    itemId: string,
    container: { kind: "top" } | { kind: "group"; groupId: string },
    index: number,
  ) => {
    const sb = toSidebarItem(itemId);
    if (!sb) return null;
    const line = editing ? insertionLineFor(container, index) : null;
    return (
      <div
        key={itemId}
        draggable={editing}
        onDragStart={handleDragStart(itemId)}
        onDragEnd={handleDragEnd}
        onDragOver={handleItemDragOver(container, index)}
        className={`group/item relative ${
          editing ? "cursor-grab active:cursor-grabbing" : ""
        } ${dragItemId === itemId ? "opacity-40" : ""}`}
      >
        {line === "above" && (
          <div
            className="absolute -top-0.5 right-1 left-1 h-0.5 rounded-full bg-emerald-500"
            aria-hidden
          />
        )}
        {line === "below" && (
          <div
            className="absolute right-1 -bottom-0.5 left-1 h-0.5 rounded-full bg-emerald-500"
            aria-hidden
          />
        )}
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
          onDragOver={handleContainerDragOver({
            kind: "top",
            itemCount: layout.topLevelItemIds.length,
          })}
          className={`space-y-1 rounded-md ${
            editing && layout.topLevelItemIds.length === 0 && dropTarget?.kind === "top"
              ? "outline-2 outline-emerald-500 outline-dashed"
              : ""
          }`}
        >
          {layout.topLevelItemIds.map((id, idx) => renderDraggableItem(id, { kind: "top" }, idx))}
        </div>

        {/* 各グループ */}
        {layout.groups.map((g) => {
          const items = g.itemIds
            .map((id) => toSidebarItem(id))
            .filter((x): x is SidebarItem => x !== null);
          return (
            <div
              key={g.id}
              onDragOver={handleContainerDragOver({
                kind: "group",
                groupId: g.id,
                itemCount: g.itemIds.length,
              })}
              className={`rounded-md ${
                editing &&
                g.itemIds.length === 0 &&
                dropTarget?.kind === "group" &&
                dropTarget.groupId === g.id
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
                      {g.itemIds.map((id, idx) =>
                        renderDraggableItem(id, { kind: "group", groupId: g.id }, idx),
                      )}
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
              onDragOver={handleContainerDragOver({ kind: "hidden" })}
              className={`bg-muted/30 mt-3 space-y-1 rounded-md p-2 ${
                dropTarget?.kind === "hidden" ? "outline-2 outline-emerald-500 outline-dashed" : ""
              }`}
            >
              <p className="text-muted-foreground text-[11px] font-medium">
                非表示({layout.hiddenItemIds.length})
              </p>
              {layout.hiddenItemIds.length === 0 ? (
                <p className="text-muted-foreground text-[10px] italic">ここにドラッグで非表示</p>
              ) : (
                /* 非表示エリアは順序を保持しない(insertion line も出さない) */
                layout.hiddenItemIds.map((id) => {
                  const sb = toSidebarItem(id);
                  if (!sb) return null;
                  return (
                    <div
                      key={id}
                      draggable={editing}
                      onDragStart={handleDragStart(id)}
                      onDragEnd={handleDragEnd}
                      className={`relative ${
                        editing ? "cursor-grab active:cursor-grabbing" : ""
                      } ${dragItemId === id ? "opacity-40" : ""}`}
                    >
                      <Link
                        href={sb.href}
                        onClick={(e) => e.preventDefault()}
                        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
                      >
                        <NavIcon name={sb.icon} className="size-3 shrink-0" />
                        <span className="text-muted-foreground flex-1 truncate">{sb.label}</span>
                      </Link>
                    </div>
                  );
                })
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
