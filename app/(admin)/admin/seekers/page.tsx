"use client";

import { useState } from "react";

import { Card } from "@/components/ui/card";

import { SeekersTable } from "./seekers-table";

/**
 * /admin/seekers
 *
 * 運営者用: 求職者 (profiles.account_type='seeker') 一覧。
 *
 * 「/admin/users」 は 全 ユーザー を 出す 汎用 リスト で、 求職者 に 特化 した 情報
 * (履歴書 数 / 応募 数 / 会話 数 / 連携 CA 社数 / 最終ログイン) は 出て いない。
 * 求職者 の 稼働 判定 に 特化 した 一覧 が 必要 な の で 別 ページ で 用意 する。
 *
 * タブ:
 *   ・現役       … profiles.archived_at IS NULL
 *   ・停止中     … profiles.archived_at NOT NULL
 *
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 */
export default function AdminSeekersPage() {
  const [tab, setTab] = useState<"active" | "archived">("active");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">求職者一覧</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Maira に登録している求職者 (account_type='seeker') の稼働状況。履歴書 / 応募 /
          AI会話数と、連携している CA 社数から一目で稼働レベルが分かるように並べます。
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
        <SeekersTable archived={tab === "archived"} />
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
