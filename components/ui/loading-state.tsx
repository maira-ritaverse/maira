import { Card } from "./card";

type Props = {
  message?: string;
  /**
   * default: カードで囲んだ標準ローディング
   * minimal: カードなし、テキストのみ(インライン用途)
   */
  variant?: "default" | "minimal";
};

/**
 * 汎用のロード中表示
 */
export function LoadingState({ message = "読み込んでいます...", variant = "default" }: Props) {
  if (variant === "minimal") {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-muted-foreground animate-pulse text-sm">{message}</span>
      </div>
    );
  }

  return (
    <Card className="p-12 text-center">
      <div className="mb-3 flex items-center justify-center">
        <div className="border-muted border-t-primary h-8 w-8 animate-spin rounded-full border-4" />
      </div>
      <p className="text-muted-foreground text-sm">{message}</p>
    </Card>
  );
}
