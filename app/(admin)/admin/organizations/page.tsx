import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { OrganizationsTable } from "./organizations-table";

/**
 * /admin/organizations
 *
 * 運営者用:エージェント企業(organizations)の一覧と健全性指標。
 * BtoBtoC 運用のため、新規企業 + admin 発行は本ページから行う。
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 */
export default function AdminOrganizationsPage() {
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
      <Card className="p-4">
        <OrganizationsTable />
      </Card>
    </div>
  );
}
