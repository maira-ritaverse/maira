"use client";

import { useRouter } from "next/navigation";

/**
 * 面接対策ページの「戻る」。
 *
 * 「面接対策を開く」を押した元の画面(顧客詳細ページのスクロール位置)にそのまま戻すため、
 * 固定リンクではなくブラウザ履歴の 1 つ前へ戻す(Next.js が スクロール位置も復元する)。
 * 直接開かれて履歴が無い場合のみ、顧客詳細ページへフォールバックする。
 */
export function InterviewPrepBackButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(`/agency/clients/${clientId}`);
        }
      }}
      className="text-muted-foreground text-sm hover:underline"
    >
      ← {clientName}さんのページに戻る
    </button>
  );
}
