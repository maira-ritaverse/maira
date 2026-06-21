"use client";

/**
 * 「Google アカウントを連携」 ボタン
 *
 * 役割:
 *   ・/api/integrations/google/connect に 遷移 して Google OAuth フロー を 開始
 *   ・callback で google_connections に refresh_token / access_token (暗号化) を upsert
 *   ・Calendar (Meet URL 付き 予定 登録) に 必要 な scope を 要求
 *
 * 設計 上 の 注意:
 *   ・以前 は Supabase Auth の linkIdentity を 呼んで いた が、 Supabase の
 *     enable_manual_linking が false の ため 「Manual linking is disabled」 で
 *     失敗 して いた。 そもそも Maira ログイン と Google identity を 紐づける
 *     必然性 は なく、 業務 用 OAuth トークン だけ あれば 連携 機能 は 動く ため、
 *     サーバ側 connect → callback フロー に 一本化 した。
 *   ・「Google でも ログイン できる」 機能 は この ボタン から は 提供 しない
 *     (将来 必要 に なれば サーバ側 で Supabase の linkIdentity API を 直接 叩く)。
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  label?: string;
};

export function GoogleLinkButton({ label = "Google アカウントを連携する" }: Props) {
  const [submitting, setSubmitting] = useState(false);

  const handleClick = () => {
    setSubmitting(true);
    window.location.href = "/api/integrations/google/connect";
  };

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={handleClick} disabled={submitting}>
        {submitting ? "Google に接続中…" : label}
      </Button>
    </div>
  );
}
