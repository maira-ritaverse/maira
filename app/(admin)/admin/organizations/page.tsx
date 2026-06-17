"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { OrganizationsTable } from "./organizations-table";

/**
 * /admin/organizations
 *
 * 運営者用:エージェント企業(organizations)の一覧と健全性指標。
 * BtoBtoC 運用のため、新規企業 + admin 発行は本ページから行う。
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 *
 * タブ:
 *   ・現役       … archived_at IS NULL
 *   ・退会済     … archived_at NOT NULL(物理削除はしない)
 */
export default function AdminOrganizationsPage() {
  const [tab, setTab] = useState<"active" | "archived">("active");
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold">エージェント企業</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            契約中のエージェント企業 / 担当アドバイザー数 / 求職者(client)数 /
            最終アクティビティを俯瞰します。
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/organizations/new" />}>
          + 新規発行
        </Button>
      </div>
      <div className="flex gap-1 border-b">
        <TabButton active={tab === "active"} onClick={() => setTab("active")}>
          現役
        </TabButton>
        <TabButton active={tab === "archived"} onClick={() => setTab("archived")}>
          退会済
        </TabButton>
      </div>
      <Card className="p-4">
        <OrganizationsTable archived={tab === "archived"} />
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
