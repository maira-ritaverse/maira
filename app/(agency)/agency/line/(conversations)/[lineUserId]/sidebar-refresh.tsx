"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * 会話 を 開いた タイミング で layout の サーバー側 再実行 を トリガー し、
 * 左サイドバー の 未読バッジ + 「対応済」 タブ 状態 を 最新化 する。
 *
 * page.tsx 側 で markConversationRead と LINE markAsRead が 実行 された 後、
 * クライアント が マウント した タイミング で router.refresh() を 1 回 叩く。
 */
type Props = { lineUserId: string };

export function SidebarRefresh({ lineUserId }: Props) {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
    // lineUserId が 変わる ごと に 1 度 だけ。 router は 同じ インスタンス なので 依存 含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineUserId]);
  return null;
}
