import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  accentClassName?: string;
};

// 「Myaira」 を 「My[ai]ra」 として 表示 し、 中央 の 「ai」 だけ
// アクセント カラー (デフォルト orange-500) に する ブランド マーク。
// 「My AI」 を 想起 さ せ、 「AI 採用 エージェント」 という プロダクト の
// 特徴 を 視覚 的 に 強調 する。
// スクリーン リーダー には aria-label で 「Myaira」 と 読ま せる。
export function BrandMark({ className, accentClassName = "text-orange-500" }: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-baseline", className)} aria-label="Myaira">
      <span aria-hidden>My</span>
      <span aria-hidden className={accentClassName}>
        ai
      </span>
      <span aria-hidden>ra</span>
    </span>
  );
}
