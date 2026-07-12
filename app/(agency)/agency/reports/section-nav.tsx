"use client";

/**
 * デスクトップ用のセクション sticky ナビ。
 *
 * ・レポート各セクションの見出しリンクを縦に並べる
 * ・スクロールに応じて active 表示を切り替える(IntersectionObserver)
 * ・モバイルでは非表示(top margin もエコにする)
 */
import { useEffect, useState } from "react";

const SECTIONS = [
  { id: "kpi", label: "サマリー" },
  { id: "achievement", label: "目標達成率" },
  { id: "roi", label: "ROI(admin)" },
  { id: "trend", label: "時系列トレンド" },
  { id: "monthly-deals", label: "成約・売上" },
  { id: "placement-rate", label: "成約率" },
  { id: "funnel", label: "選考ファネル" },
  { id: "company", label: "企業別" },
  { id: "entry-source", label: "エントリーサイト別" },
  { id: "advisor", label: "アドバイザー別" },
  { id: "phase-duration", label: "所要日数" },
  { id: "status-distribution", label: "ステータス分布" },
];

export function SectionNav() {
  const [activeId, setActiveId] = useState<string>("kpi");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // 一番上に近い可視要素を active に
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );

    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="no-print sticky top-4 hidden w-40 shrink-0 space-y-0.5 self-start text-sm md:block">
      <p className="text-muted-foreground mb-2 text-xs font-semibold">レポート項目</p>
      {SECTIONS.map((s) => {
        const isActive = activeId === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`block rounded px-2 py-1 text-xs transition-colors ${
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
