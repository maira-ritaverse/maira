import Link from "next/link";

import { Card } from "@/components/ui/card";

import { ClientDetail } from "./client-detail";

/**
 * /admin/clients/[id]
 *
 * 運営者用: 求職者 (client_records) 1 件 の 詳細。 基本 プロフィール は
 * 常時 表示、 暗号化 の 内部 メモ (推薦文 / 面談メモ 等) は トグル で 展開 +
 * audit ログ 記録 (POST /api/admin/clients/[id]/reveal-notes)。
 *
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 */
export default async function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/clients" className="text-muted-foreground text-sm hover:underline">
          ← 求職者 CRM 一覧に戻る
        </Link>
      </div>
      <Card className="p-6">
        <ClientDetail clientId={id} />
      </Card>
    </div>
  );
}
