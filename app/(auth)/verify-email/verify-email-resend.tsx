"use client";

import { useState, useTransition } from "react";

import { resendConfirmationEmail } from "@/app/auth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 確認メール 再送フォーム(verify-email ページ内)
 *
 * ・確認メールが 届かない / 別端末で リンクが 失敗する ユーザー向けの 自己解決導線。
 * ・server action resendConfirmationEmail は 常に success を 返す(enumeration 対策)
 *   ので、ここでも 成否を 分岐させず 一律の 完了文言を 出す。
 */
export function VerifyEmailResend() {
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    // 簡易バリデーション(サーバー側でも正規化するが、空送信を弾く)。
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("メールアドレスの形式が正しくありません。");
      return;
    }
    setError(null);
    startTransition(async () => {
      await resendConfirmationEmail(trimmed);
      setSubmitted(true);
    });
  };

  if (submitted) {
    return (
      <Alert>
        <AlertDescription>
          入力されたメールアドレスが未確認で登録されている場合、確認用のリンクを再送しました。
          メール(迷惑メールフォルダも)をご確認ください。別のスマホ /
          パソコンで開いても確認できます。
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-left">
      <div className="space-y-2">
        <Label htmlFor="resend-email">確認メールを再送する</Label>
        <Input
          id="resend-email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          disabled={isPending}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={isPending}>
        {isPending ? "送信中..." : "確認メールを再送する"}
      </Button>
    </form>
  );
}
