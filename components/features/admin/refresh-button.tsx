"use client";

import { Button } from "@/components/ui/button";

type Props = {
  onClick: () => void;
  loading?: boolean;
  /** 表示位置のラベル(aria-label / title)。省略時は「再読み込み」。 */
  label?: string;
};

/**
 * 運営管理画面の共通「再読み込み」ボタン。
 *
 * UX 設計:
 *   - 小さなアイコンだけのボタン(各テーブルの右端に置く想定)
 *   - 読み込み中は ↻ を回転させて操作を視覚化
 *   - disabled 中は連打防止
 *
 * 実装上の注意:
 *   - hover で枠を出す(視覚的にクリック可能であることを伝える)
 *   - 文字サイズはアイコンとして固定(text-lg)
 */
export function RefreshButton({ onClick, loading, label = "再読み込み" }: Props) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={loading}
      title={label}
      aria-label={label}
      className="h-8 w-8 p-0"
    >
      <span aria-hidden className={`inline-block text-lg ${loading ? "animate-spin" : ""}`}>
        ↻
      </span>
    </Button>
  );
}
