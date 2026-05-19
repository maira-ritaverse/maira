import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl space-y-8 text-center">
        <div>
          <h1 className="mb-4 text-5xl font-bold tracking-tight">Maira</h1>
          <p className="text-muted-foreground mb-2 text-xl">あなただけのAI転職エージェント</p>
          <p className="text-muted-foreground text-sm">Coming Soon</p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button render={<Link href="/auth/signup" />}>新規登録</Button>
          <Button variant="outline" render={<Link href="/auth/login" />}>
            ログイン
          </Button>
        </div>

        <div className="text-muted-foreground text-xs">© 2026 株式会社RITAVERSE</div>
      </div>
    </main>
  );
}
