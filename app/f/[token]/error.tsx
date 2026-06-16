"use client";

import { useEffect } from "react";

/**
 * 公開フォーム /f/[token] のエラーバウンダリ。
 * 認証不要なため、信頼できるサーバ側の例外をユーザに最低限の情報で返す。
 */
export default function PublicIntakeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Public intake error:", error);
  }, [error]);

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-bold">フォームの読み込みに失敗しました</h1>
        <p className="text-muted-foreground text-sm">
          通信状況をご確認の上、再試行してください。
          解消しない場合は、ご担当者にお問い合わせください。
        </p>
        <button
          type="button"
          onClick={reset}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
