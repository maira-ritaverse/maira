import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listConversations } from "@/lib/line/conversations";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { ImportHistoryClient } from "./import-history-client";

/**
 * /agency/line/import
 *
 * LINE OA Manager 等 から エクスポート した チャット 履歴 CSV を 取込 する ページ。
 * admin 限定。
 */
export const dynamic = "force-dynamic";

export default async function LineImportHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }
  if (role.member.role !== "admin") {
    redirect("/agency/line");
  }

  const channel = await getMyLineChannel(supabase);
  if (!channel) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-2xl font-bold">過去履歴 取込</h1>
        <Card className="mt-4 p-5">
          <p className="text-sm">
            LINE 公式アカウント が 未接続 です。{" "}
            <Link href="/agency/settings/integrations/line" className="font-medium underline">
              連携設定 →
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  // 友達 一覧 (選択用)
  const conversations = await listConversations(supabase);
  const friends = conversations
    .filter((c) => !c.unfollowedAt)
    .map((c) => ({
      lineUserId: c.lineUserId,
      displayName: c.displayName ?? "(名前なし)",
      clientName: c.clientName,
    }));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">過去履歴 取込</h1>
          <Link
            href="/agency/line"
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            ← トーク 一覧
          </Link>
        </div>

        <Card className="space-y-3 p-5 text-sm">
          <h2 className="font-semibold">取込 手順</h2>
          <ol className="ml-5 list-decimal space-y-1.5 text-xs">
            <li>
              <a
                href="https://manager.line.biz/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                LINE Official Account Manager
              </a>{" "}
              で 設定 → ログ → 「ログを出力」 で チャット履歴 CSV を ダウンロード
              <p className="text-muted-foreground mt-0.5">
                ※ プラン により 制限 あり (ライト プラン 以上 推奨)
              </p>
            </li>
            <li>下記 で 「対象 友達」 を 選択 + CSV を アップロード</li>
            <li>
              「自分」 と 判定 する 送信者名 を 指定 (LINE Manager 上 の OA 名 / ボット名 を
              カンマ区切り で 入力)
            </li>
            <li>取込 → メッセージ 履歴 に 過去 分 が 統合 されます (重複 自動 排除)</li>
          </ol>
        </Card>

        <ImportHistoryClient friends={friends} />

        <Card className="p-5 text-xs">
          <p className="text-muted-foreground font-semibold">注意 事項</p>
          <ul className="text-muted-foreground mt-2 ml-4 list-disc space-y-1">
            <li>テキスト メッセージ のみ 対応 (画像 / スタンプ / 動画 は スキップ)</li>
            <li>本文 は AES-256-GCM 暗号化 で 保存</li>
            <li>同じ 行 を 2 回 取込 ん で も 重複 INSERT は されない</li>
            <li>CSV 列名 が 異なる 場合 は ヘッダ 自動 マッピング で 対応</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
