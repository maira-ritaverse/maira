import { Mail } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

import { VerifyEmailResend } from "./verify-email-resend";

export default function VerifyEmailPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-4">
          <div className="flex justify-center">
            <Mail className="text-muted-foreground h-16 w-16" />
          </div>
          <h1 className="text-3xl font-bold">確認メールを送信しました</h1>
          <p className="text-muted-foreground">
            登録いただいたメールアドレスに確認用のリンクを送信しました。
            メール内のリンクをクリックして、登録を完了してください。
          </p>
        </div>

        <div className="bg-card space-y-4 rounded-lg border p-6 text-sm">
          <div className="text-left">
            <p className="font-semibold">メールが届かない / リンクが開けない場合:</p>
            <ul className="text-muted-foreground mt-1 space-y-1">
              <li>・迷惑メールフォルダをご確認ください</li>
              <li>・登録した端末と別のスマホ / パソコンで開いても確認できます</li>
              <li>・下のフォームから確認メールを再送できます</li>
            </ul>
          </div>
          <VerifyEmailResend />
        </div>

        <Button variant="outline" className="w-full" render={<Link href="/login" />}>
          ログイン画面に戻る
        </Button>
      </div>
    </main>
  );
}
