"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

/**
 * アプリ全体のエラーバウンダリ
 *
 * - app/(app)/app/error.tsx が存在するため、認証エリア内のエラーはそちらに捕捉される
 * - ここは認証前(LP・規約等)や、より外側のレイアウトでのエラーをキャッチする
 * - error.tsx は仕様上 Client Component でなければならない
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 将来:Sentry 等のエラートラッキングサービスへ送信
    console.error("Global error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <ErrorState
          title="予期せぬエラーが発生しました"
          description="ご不便をおかけします。再試行するか、トップページに戻ってください。"
          errorMessage={error.message}
          onRetry={reset}
          extraAction={
            <Button render={<Link href="/" />} variant="outline">
              トップに戻る
            </Button>
          }
        />
      </div>
    </div>
  );
}
