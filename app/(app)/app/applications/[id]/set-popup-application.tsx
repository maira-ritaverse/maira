"use client";

import { useEffect } from "react";
import { usePopupChat } from "@/components/features/popup-chat";

/**
 * 応募詳細ページ専用:PopupChatContext に「現在の応募ID」を伝達する
 *
 * - マウント時:setCurrentApplication(id) で applicationId をセット
 *   (ポップアップは自動では開かない。Launcher の表示制御だけ有効になる)
 * - アンマウント時:setCurrentApplication(null) で解除
 *   (応募ページから離脱したら Launcher も Window も非表示にしたいため)
 *
 * Server Component の page.tsx 上で直接 Context にアクセスできないため、
 * このクライアント側のフラグメントで仲介する。
 */
export function SetPopupApplication({ applicationId }: { applicationId: string }) {
  const { setCurrentApplication } = usePopupChat();

  useEffect(() => {
    setCurrentApplication(applicationId);
    return () => {
      setCurrentApplication(null);
    };
  }, [applicationId, setCurrentApplication]);

  return null;
}
