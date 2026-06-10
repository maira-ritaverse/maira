import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-4">
          <div className="text-6xl">📧</div>
          <h1 className="text-3xl font-bold">確認メールを送信しました</h1>
          <p className="text-muted-foreground">
            登録いただいたメールアドレスに確認用のリンクを送信しました。
            メール内のリンクをクリックして、登録を完了してください。
          </p>
        </div>

        <div className="bg-card space-y-3 rounded-lg border p-6 text-left text-sm">
          <p className="font-semibold">メールが届かない場合:</p>
          <ul className="text-muted-foreground space-y-1">
            <li>・迷惑メールフォルダをご確認ください</li>
            <li>・数分待ってもメールが届かない場合は、再度登録をお試しください</li>
          </ul>
        </div>

        <Button variant="outline" className="w-full" render={<Link href="/login" />}>
          ログイン画面に戻る
        </Button>
      </div>
    </main>
  );
}
