"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

/**
 * エージェントエリア用のエラーバウンダリ
 *
 * /agency 配下のサーバーコンポーネントで投げられた例外を捕まえる。
 * 親レイアウト(エージェントサイドバー・ヘッダー)は維持される。
 *
 * Next.js の仕様により error.tsx は必ず Client Component(use client)で書く。
 */
export default function AgencyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 将来:Sentry 等のエラートラッキングサービスへ送信
    console.error("Agency error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl py-8">
      <ErrorState
        title="エラーが発生しました"
        description="この画面の表示中に問題が発生しました。再試行してください。"
        errorMessage={error.message}
        onRetry={reset}
        extraAction={
          <Button render={<Link href="/agency" />} variant="outline">
            ダッシュボードに戻る
          </Button>
        }
      />
    </div>
  );
}
