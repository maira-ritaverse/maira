"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

/**
 * 認証必須エリア用のエラーバウンダリ
 *
 * 親レイアウト(サイドバー・ヘッダー)はそのまま残し、
 * main 部分だけがエラー表示に置き換わるのが Next.js のルーティング仕様。
 * これにより「ナビゲーションは効くがコンテンツが壊れている」状態を
 * ユーザーに自然に伝えられる。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl py-8">
      <ErrorState
        title="エラーが発生しました"
        description="この画面の表示中に問題が発生しました。再試行してください。"
        errorMessage={error.message}
        onRetry={reset}
        extraAction={
          <Button render={<Link href="/app" />} variant="outline">
            ダッシュボードに戻る
          </Button>
        }
      />
    </div>
  );
}
