import Link from "next/link";

import { TERMS_LAST_UPDATED, TERMS_SECTIONS, TERMS_TITLE } from "@/lib/terms/terms-content";

/**
 * 利用規約
 *
 * 文面は lib/terms/terms-content.ts を単一ソースとして描画する。
 * 同意ゲート / 署名済み PDF と同じ本文を参照し、ズレを防ぐ。
 */
export const metadata = {
  title: "利用規約 | Myaira",
  description: "Myaira の利用規約。",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="space-y-6 text-sm leading-relaxed">
        <header>
          <h1 className="text-3xl font-bold">{TERMS_TITLE}</h1>
          <p className="text-muted-foreground mt-1 text-xs">最終更新日:{TERMS_LAST_UPDATED}</p>
        </header>

        {TERMS_SECTIONS.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
            {section.bullets && (
              <ul className="ml-6 list-disc space-y-1">
                {section.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <footer className="text-muted-foreground border-t pt-4 text-xs">
          <p>© 2026 Revorise Inc.</p>
          <p className="mt-1">
            関連:
            <Link href="/privacy" className="ml-2 underline">
              プライバシーポリシー
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}
