"use client";

import { useState } from "react";

import { Card } from "@/components/ui/card";

import { UsersTable } from "./users-table";

/**
 * /admin/users
 *
 * 運営者用:ユーザ一覧 / 検索 / アーカイブ(停止)。
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 *
 * タブ:
 *   ・現役       … profiles.archived_at IS NULL
 *   ・停止中     … profiles.archived_at NOT NULL(物理削除はしない)
 *
 * 物理削除は基本提供しない(履歴 / 監査ログ / 紐付くデータが多すぎるため)。
 * 完全削除が必要な場合は運営側で別途対応。
 */
export default function AdminUsersPage() {
  const [tab, setTab] = useState<"active" | "archived">("active");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">ユーザ管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          すべてのユーザ(求職者 / エージェント企業メンバー / 運営者)の一覧。メアド検索 +
          アーカイブ操作。
        </p>
      </div>
      <div className="flex gap-1 border-b">
        <TabButton active={tab === "active"} onClick={() => setTab("active")}>
          現役
        </TabButton>
        <TabButton active={tab === "archived"} onClick={() => setTab("archived")}>
          停止中
        </TabButton>
      </div>
      <Card className="p-4">
        <UsersTable archived={tab === "archived"} />
      </Card>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-foreground text-foreground"
          : "text-muted-foreground hover:text-foreground border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
