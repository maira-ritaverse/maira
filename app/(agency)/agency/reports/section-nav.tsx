"use client";

/**
 * デスクトップ用のセクション sticky ナビ。
 *
 * ・レポート各セクションの見出しリンクを縦に並べる
 * ・スクロールに応じて active 表示を切り替える(IntersectionObserver)
 * ・モバイルでは非表示
 *
 * セクション一覧は page.tsx から受け取る(SECTION_CATALOG と表示設定を
 * 反映した順序で渡ってくる)。 ここでハードコードしないことで、カスタマイズ
 * パネルの並び順とサイドバーの並び順が常に同期する。
 */
import { useEffect, useState } from "react";

type Section = { id: string; label: string };

type Props = {
  sections: Section[];
};

export function SectionNav({ sections }: Props) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    if (sections.length === 0) return;

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

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length === 0) return null;

  return (
    <nav className="no-print sticky top-4 hidden w-40 shrink-0 space-y-0.5 self-start text-sm md:block">
      <p className="text-muted-foreground mb-2 text-xs font-semibold">レポート項目</p>
      {sections.map((s) => {
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
