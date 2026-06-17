"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CustomizableSidebar } from "./customizable-sidebar";
import type { ItemDescriptor, SidebarLayout } from "@/lib/sidebar-layout/types";

/**
 * 求職者向けサイドバー
 *
 * カタログ(availableItems)と初期レイアウト(defaultLayout)を CustomizableSidebar に
 * 渡すだけ。並び替え / グループ化 / 非表示は localStorage 経由でユーザ管理。
 */

type Props = {
  invitedCount?: number;
};

const STORAGE_KEY = "maira-seeker-sidebar";

const AVAILABLE_ITEMS: ItemDescriptor[] = [
  { id: "dashboard", href: "/app", icon: "dashboard", defaultLabel: "ダッシュボード" },
  {
    id: "diagnosis",
    href: "/app/diagnosis",
    icon: "diagnosis",
    defaultLabel: "キャリア診断",
    dataAttr: "nav-diagnosis",
  },
  {
    id: "career",
    href: "/app/career",
    icon: "message",
    defaultLabel: "キャリア棚卸し",
    dataAttr: "nav-career",
  },
  {
    id: "resumes",
    href: "/app/resumes",
    icon: "resume",
    defaultLabel: "履歴書",
    dataAttr: "nav-resumes",
  },
  { id: "cvs", href: "/app/cvs", icon: "cv", defaultLabel: "職務経歴書", dataAttr: "nav-cvs" },
  {
    id: "documents",
    href: "/app/documents",
    icon: "document",
    defaultLabel: "志望動機・自己PR",
    dataAttr: "nav-documents",
  },
  {
    id: "agent-drafts",
    href: "/app/agent-drafts",
    icon: "inbox",
    defaultLabel: "エージェントからの書類",
  },
  {
    id: "recommended-jobs",
    href: "/app/recommended-jobs",
    icon: "sparkles",
    defaultLabel: "AI 求人推薦",
    dataAttr: "nav-recommended-jobs",
  },
  { id: "applications", href: "/app/applications", icon: "applications", defaultLabel: "応募管理" },
  {
    id: "agent-referrals",
    href: "/app/agent-referrals",
    icon: "tasks",
    defaultLabel: "エージェント推薦進捗",
    dataAttr: "nav-agent-referrals",
  },
  {
    id: "recommendation-letters",
    href: "/app/recommendation-letters",
    icon: "award",
    defaultLabel: "推薦文",
    dataAttr: "nav-recommendation-letters",
  },
  { id: "interview", href: "/app/interview", icon: "bot", defaultLabel: "面接練習" },
  { id: "connections", href: "/app/connections", icon: "link", defaultLabel: "エージェント連携" },
];

const DEFAULT_LAYOUT: SidebarLayout = {
  topLevelItemIds: ["dashboard", "interview", "connections"],
  groups: [
    {
      id: "prep",
      title: "キャリア準備",
      itemIds: ["diagnosis", "career"],
    },
    {
      id: "docs",
      title: "書類作成",
      itemIds: ["resumes", "cvs", "documents", "agent-drafts"],
    },
    {
      id: "jobs",
      title: "求人・応募",
      itemIds: ["recommended-jobs", "applications", "agent-referrals", "recommendation-letters"],
    },
  ],
  hiddenItemIds: [],
};

export function AppSidebar({ invitedCount = 0 }: Props) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  const badges = {
    connections: invitedCount > 0 ? invitedCount : undefined,
  };

  return (
    <CustomizableSidebar
      storageKey={STORAGE_KEY}
      availableItems={AVAILABLE_ITEMS}
      defaultLayout={DEFAULT_LAYOUT}
      isActive={isActive}
      badges={badges}
      asideDataTour="sidebar"
      header={
        <Link href="/app" className="text-xl font-bold">
          Maira
        </Link>
      }
    />
  );
}
