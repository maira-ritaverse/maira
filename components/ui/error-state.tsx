"use client";

import type { ReactNode } from "react";

import { Alert, AlertDescription } from "./alert";
import { Button } from "./button";
import { Card } from "./card";

type Variant = "default" | "ai" | "network" | "permission" | "notFound";

type Props = {
  /** エラー種別ごとの既定文言を切り替える */
  variant?: Variant;
  /** 既定タイトルを上書き */
  title?: string;
  /** 既定説明を上書き */
  description?: string;
  /** 再試行ボタンのハンドラ */
  onRetry?: () => void;
  /** 詳細メッセージ(開発環境でのみ表示) */
  errorMessage?: string;
  /** ホームに戻る等の追加アクション */
  extraAction?: ReactNode;
};

const defaultMessages: Record<Variant, { title: string; description: string }> = {
  default: {
    title: "エラーが発生しました",
    description: "申し訳ありません。もう一度お試しください。",
  },
  ai: {
    title: "AI応答の生成に失敗しました",
    description:
      "少し時間を置いてから再度お試しください。問題が続く場合はサポートにご連絡ください。",
  },
  network: {
    title: "通信エラーが発生しました",
    description: "インターネット接続を確認してから再度お試しください。",
  },
  permission: {
    title: "アクセス権がありません",
    description: "このコンテンツを表示する権限がありません。",
  },
  notFound: {
    title: "見つかりませんでした",
    description: "お探しのコンテンツが見つかりませんでした。",
  },
};

/**
 * 汎用のエラー表示
 *
 * 詳細メッセージは「秘密が漏れないように」開発環境のみで表示する。
 * 本番では汎用文言+任意の再試行ボタンのみが見える。
 */
export function ErrorState({
  variant = "default",
  title,
  description,
  onRetry,
  errorMessage,
  extraAction,
}: Props) {
  const defaults = defaultMessages[variant];
  const displayTitle = title ?? defaults.title;
  const displayDescription = description ?? defaults.description;
  const showErrorDetail = Boolean(errorMessage) && process.env.NODE_ENV === "development";

  return (
    <Card className="p-8 text-center">
      <p className="mb-3 text-4xl" aria-hidden="true">
        ⚠️
      </p>
      <p className="text-lg font-medium">{displayTitle}</p>
      <p className="text-muted-foreground mt-2 text-sm">{displayDescription}</p>

      {showErrorDetail && (
        <Alert variant="destructive" className="mt-6 text-left">
          <AlertDescription className="font-mono text-xs">{errorMessage}</AlertDescription>
        </Alert>
      )}

      {(onRetry || extraAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button onClick={onRetry} variant="default">
              再試行
            </Button>
          )}
          {extraAction}
        </div>
      )}
    </Card>
  );
}
