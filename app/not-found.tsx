import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

/**
 * 404ページ
 *
 * not-found.tsx は Server Component で問題ない。
 * ErrorState は内部で "use client" を持つが、Server Component から
 * Client Component を子として描画するのは Next.js の通常パターン。
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <ErrorState
          variant="notFound"
          title="ページが見つかりません"
          description="お探しのページは存在しないか、移動した可能性があります。"
          extraAction={
            <Button render={<Link href="/" />} variant="default">
              トップに戻る
            </Button>
          }
        />
      </div>
    </div>
  );
}
