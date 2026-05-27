import { LoadingState } from "@/components/ui/loading-state";

/**
 * 認証エリア用のローディング
 *
 * Server Component のデータ取得が走っている間、Suspense 境界として
 * 自動的に表示される。サイドバー・ヘッダーはそのまま残る。
 */
export default function AppLoading() {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <LoadingState />
    </div>
  );
}
