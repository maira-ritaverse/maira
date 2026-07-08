"use client";

import { Building2, Crown, User, Users, UserSquare2 } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import type { OrgGraph, OrgGraphNode } from "@/lib/teams/graph";

/**
 * 組織 ツリー ビュー。 3 隚層 (組織 → team / 未 割当 pool → member) を
 * インデント + アイコン + 数字 で 表示 する 手 実装 ツリー。
 *
 * 依存 ライブラリ を 追加 しない ため、 SVG connector 等 は 使わ ず シンプル な
 * 左 インデント と 縦線 (border-l) で 隚層 感 を 出す。
 */
type Props = { graph: OrgGraph };

export function OrgTreeView({ graph }: Props) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        {/* 組織レベル */}
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-emerald-700" />
          <span className="font-semibold">{graph.name}</span>
          <span className="text-muted-foreground text-xs">
            メンバー {graph.totalMembers}名 / 顧客 {graph.totalClients}件
          </span>
        </div>

        <div className="mt-3 space-y-1 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
          {graph.children.map((child) => (
            <TreeNode key={nodeKey(child)} node={child} depth={1} />
          ))}
        </div>
      </Card>

      <p className="text-muted-foreground text-xs">
        ※「未割当」は、どのリスト表にも属していない顧客の集合で、組織メンバー全員から閲覧できます。リスト表を作って割り当てると、徐々に分離が進みます。
      </p>
    </div>
  );
}

function nodeKey(n: OrgGraphNode): string {
  switch (n.kind) {
    case "team":
      return `team:${n.id}`;
    case "member":
      return `member:${n.id}`;
    case "unassigned_pool":
      return "unassigned";
    case "organization":
      return `org:${n.id}`;
  }
}

function TreeNode({ node, depth }: { node: OrgGraphNode; depth: number }) {
  const [open, setOpen] = useState(depth <= 2); // 初期 は 2 段目 まで 展開

  switch (node.kind) {
    case "team":
      return (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1 text-left"
            aria-expanded={open}
          >
            <span
              className="h-3 w-3 rounded-full border"
              style={{ backgroundColor: node.color ?? "#94a3b8" }}
            />
            <Users className="h-4 w-4 text-slate-600" />
            <span className="font-medium">{node.name}</span>
            <span className="text-muted-foreground text-xs">
              メンバー {node.memberCount}名 / 顧客 {node.clientCount}件
            </span>
            <span className="text-muted-foreground ml-auto text-xs">{open ? "▼" : "▶"}</span>
          </button>
          {open && node.children.length > 0 && (
            <div className="mt-1 space-y-1 border-l-2 border-slate-100 pl-4 dark:border-slate-800">
              {node.children.map((child) => (
                <TreeNode key={nodeKey(child)} node={child} depth={depth + 1} />
              ))}
            </div>
          )}
          {open && node.children.length === 0 && (
            <p className="text-muted-foreground pl-6 text-xs">
              メンバー未登録。リスト表管理画面から追加してください。
            </p>
          )}
        </div>
      );

    case "unassigned_pool":
      return (
        <div className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-900/40">
          <UserSquare2 className="h-4 w-4 text-slate-500" />
          <span className="text-sm">未割当</span>
          <span className="text-muted-foreground text-xs">顧客 {node.clientCount}件</span>
        </div>
      );

    case "member":
      return (
        <div className="flex items-center gap-2 rounded-md px-2 py-0.5 text-sm">
          {node.role === "admin" ? (
            <Crown className="h-3.5 w-3.5 text-amber-600" />
          ) : (
            <User className="h-3.5 w-3.5 text-slate-500" />
          )}
          <span>{node.displayName}</span>
          {node.teamRole === "lead" && (
            <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              リーダー
            </span>
          )}
          <span className="text-muted-foreground ml-auto text-xs">
            主担当 {node.assignedClientCount}件
          </span>
        </div>
      );

    case "organization":
      // 通常 は トップ レベル で しか 使わ ない ので ここ は 到達 しない
      return null;
  }
}
