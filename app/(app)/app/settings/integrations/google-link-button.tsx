"use client";

/**
 * 既存ユーザーが「Google アカウントを連携」するボタン
 *
 * 役割:
 *   ・Supabase Auth の linkIdentity を呼んで、既存 user_id に Google identity を追加
 *   ・同時にスコープ(calendar.events + drive.readonly)も要求して、Calendar / Drive API
 *     のアクセストークンを google_connections に保存(callback で処理)
 *   ・成功すると「次回から Google でもログインできる」状態になる
 *
 * 重要:
 *   ・linkIdentity は同一 user_id に identity を追加する操作。
 *     既存メール/パスワードを残したまま、Google でも入れるようにする。
 *   ・既に同じ Google アカウントが別の Maira ユーザーに紐づいていると失敗する。
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { GOOGLE_AUTH_SCOPES } from "@/lib/auth/google-oauth";
import { createClient } from "@/lib/supabase/client";

type Props = {
  label?: string;
};

export function GoogleLinkButton({ label = "Google アカウントを連携する" }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent("/agency/settings/integrations?connected=google")}`;
    const { error: err } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        scopes: GOOGLE_AUTH_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
        redirectTo,
      },
    });
    if (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={handleClick} disabled={submitting}>
        {submitting ? "Google に接続中…" : label}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
