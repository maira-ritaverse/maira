import type { ReactNode } from "react";

/**
 * ページ レベル の 見出し。
 *
 * Maira 内 で h1 の 大きさ / 色 / 副題 の 出し方 が ページ ごと に バラついて いた
 * (text-2xl / text-xl / text-lg / 太字 のみ / 色 つき 等) ため、 統一 用 の
 * 薄い ラッパー を 用意。 段階 的 に 各 ページ で 採用 して いく。
 *
 * 使い方:
 *   <PageHeading title="個人設定" description="通知 や 連携 を 変更 でき ます" />
 *   <PageHeading title="クライアント 一覧" action={<Button>+ 追加</Button>} />
 */
export type PageHeadingProps = {
  title: ReactNode;
  /** 副題 / 説明 文 (任意) */
  description?: ReactNode;
  /** 右端 に 配置 する アクション (ボタン 等、 任意) */
  action?: ReactNode;
};

export function PageHeading({ title, description, action }: PageHeadingProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * セクション 見出し (PageHeading の 1 段 下)。
 * 1 ページ 内 で 複数 セクション に 分かれる 場合 の h2 として 使う。
 */
export type SectionHeadingProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function SectionHeading({ title, description, action }: SectionHeadingProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
