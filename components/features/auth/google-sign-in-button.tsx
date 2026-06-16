"use client";

/**
 * 「Google で続行」ボタン(ログイン / サインアップ共通)
 *
 * クリック → Supabase Auth で Google OAuth 開始 → Google 同意画面 → /auth/callback
 *
 * Props:
 *   ・label … ボタン文言(「Google でログイン」「Google で登録」など)
 *   ・next  … OAuth 後の遷移先(招待トークンと排他)
 *   ・invitationToken … 招待経由のサインアップで next=/invite/[token] を組む
 */
import { useState } from "react";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { startGoogleAuth } from "@/lib/auth/google-oauth";

type Props = {
  label: string;
  next?: string;
  invitationToken?: string;
};

export function GoogleSignInButton({ label, next, invitationToken }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setSubmitting(true);
    setError(null);
    const { error: err } = await startGoogleAuth({ next, invitationToken });
    if (err) {
      setError(err);
      setSubmitting(false);
    }
    // 成功時はリダイレクトされるのでここには来ない
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={submitting}
        className="w-full gap-2"
      >
        <LogIn className="size-4" aria-hidden />
        {submitting ? "Google に接続中…" : label}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
