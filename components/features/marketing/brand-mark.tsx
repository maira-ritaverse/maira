import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  accentClassName?: string;
};

// 「Maira」 を 「M[Ai]ra」 として 表示 し、 中央 の 「Ai」 だけ
// アクセント カラー (デフォルト orange-500) に する ブランド マーク。
// 「AI 採用 エージェント」 という プロダクト の 特徴 を 視覚 的 に 強調 する。
// スクリーン リーダー には aria-label で 「Maira」 と 読ま せる。
export function BrandMark({ className, accentClassName = "text-orange-500" }: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-baseline", className)} aria-label="Maira">
      <span aria-hidden>M</span>
      <span aria-hidden className={accentClassName}>
        Ai
      </span>
      <span aria-hidden>ra</span>
    </span>
  );
}
