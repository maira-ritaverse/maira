"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CustomizableSidebar } from "@/components/features/customizable-sidebar";
import type { ItemDescriptor, SidebarLayout } from "@/lib/sidebar-layout/types";
import type { OrganizationRole } from "@/lib/organizations/types";

/**
 * エージェント向けサイドバー(カスタマイズ可能)
 *
 * 並び替え・グループ化・非表示はユーザの localStorage で管理。
 * role に応じて availableItems を出し分け(admin 限定の「メンバー管理」)。
 */

type Props = {
  organizationName: string;
  memberRole: OrganizationRole;
};

const STORAGE_KEY = "maira-agency-sidebar";

const BASE_ITEMS: ItemDescriptor[] = [
  { id: "dashboard", href: "/agency", icon: "dashboard", defaultLabel: "ダッシュボード" },
  { id: "clients", href: "/agency/clients", icon: "users", defaultLabel: "求職者管理" },
  { id: "jobs", href: "/agency/jobs", icon: "briefcase", defaultLabel: "求人管理" },
  { id: "calendar", href: "/agency/calendar", icon: "calendar", defaultLabel: "カレンダー" },
  { id: "line", href: "/agency/line", icon: "message", defaultLabel: "LINE" },
  // LINE 設定: 新規 一斉配信 (テキスト / 求人 / 予約) を 登録 する 設定 画面。
  // /agency/line (トーク 一覧 + 履歴) と は 役割 が 違う ので 別 項目 に。
  {
    id: "line-settings",
    href: "/agency/line/settings",
    icon: "megaphone",
    defaultLabel: "LINE設定",
  },
  { id: "marketing", href: "/agency/marketing", icon: "megaphone", defaultLabel: "マーケティング" },
  { id: "announcements", href: "/agency/announcements", icon: "bell", defaultLabel: "お知らせ" },
  { id: "reports", href: "/agency/reports", icon: "reports", defaultLabel: "レポート" },
  { id: "settings", href: "/agency/settings", icon: "settings", defaultLabel: "個人設定" },
];
const ADMIN_ITEMS: ItemDescriptor[] = [
  {
    id: "management",
    href: "/agency/management",
    icon: "reports",
    defaultLabel: "組織マネジメント",
  },
  { id: "members", href: "/agency/members", icon: "user-cog", defaultLabel: "メンバー管理" },
];

/**
 * デフォルト レイアウト (新規 ユーザー / 初期 化 時):
 *   1. ダッシュボード (top)
 *   2. カレンダー    (top)
 *   3. 公式ライン    (group: LINE / LINE設定)
 *   4. 顧客・求人管理  (group: 求職者管理 / 求人管理)
 *   5. マーケティング  (タイトル無し group = 順番 制御 用)
 *   6. お知らせ      ↑同 group
 *   7. レポート      ↑同 group
 *   設定           (group: メンバー管理 / 個人設定)
 *
 * 「面談」 は サイドバー から 除外 (カレンダー / 顧客 詳細 から アクセス できる ため)。
 *
 * 注: 描画 順 は 「topLevelItemIds → groups[*]」 固定 の ため、
 *     カレンダー の 「後 に」 公式ライン グループ を 挟む に は
 *     topLevel を 最小 (ダッシュボード / カレンダー) に 留め、
 *     残り を group (タイトル 有 / 無) で 順序 制御 する。
 */
const DEFAULT_LAYOUT: SidebarLayout = {
  topLevelItemIds: ["dashboard", "calendar"],
  groups: [
    {
      id: "line-group",
      title: "公式ライン",
      itemIds: ["line", "line-settings"],
    },
    {
      id: "crm",
      title: "顧客・求人管理",
      itemIds: ["clients", "jobs"],
    },
    {
      // title null = タイトル 行 を 出さず トップ レベル 風 に フラット 表示。
      // 順番 制御 だけ の ため の 区切り グループ。
      id: "flat-tail",
      title: null,
      itemIds: ["marketing", "announcements", "reports"],
    },
    {
      id: "settings-group",
      title: "設定",
      itemIds: ["members", "settings"],
    },
  ],
  hiddenItemIds: [],
};

export function AgencySidebar({ organizationName, memberRole }: Props) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/agency" ? pathname === "/agency" : pathname.startsWith(href);

  // role に応じて項目フィルタ(admin のみ「メンバー管理」)
  const availableItems = [...BASE_ITEMS, ...(memberRole === "admin" ? ADMIN_ITEMS : [])];

  return (
    <CustomizableSidebar
      storageKey={STORAGE_KEY}
      availableItems={availableItems}
      defaultLayout={DEFAULT_LAYOUT}
      isActive={isActive}
      header={
        <div>
          <Link href="/agency" className="flex items-center gap-2" aria-label="Maira エージェント">
            <Image
              src="/icon-192.png"
              alt=""
              width={24}
              height={24}
              priority
              className="size-6 shrink-0"
            />
            <p className="text-muted-foreground text-xs">エージェント管理</p>
          </Link>
          <p className="mt-1 truncate font-bold">{organizationName}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {memberRole === "admin" ? "管理者" : "アドバイザー"}
          </p>
        </div>
      }
    />
  );
}
