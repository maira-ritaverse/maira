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
  /**
   * 求職者(client_record)招待トークン。
   * メンバー招待と違って /invite/[token] 着地は不要(callback で email 一致で
   * 自動 accept する設計)。next の組み立てには使わず、startGoogleAuth に渡して
   * 必要なら将来の Google 招待固有 UX(例:Google アカウント選択時の文言表示)に
   * 拡張するためのフックとしてのみ持つ。
   */
  clientInvitationToken?: string;
};

export function GoogleSignInButton({
  label,
  next,
  invitationToken,
  clientInvitationToken: _clientInvitationToken,
}: Props) {
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
