"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Solo 確認後の 自動セットアップ(client)。
 *
 * ・マウント時に 1 度だけ 既存 API /api/self-serve/create-solo-account を 呼び、
 *   個人 org + プランを 作成 → Checkout / /agency へ フルページ遷移。
 * ・成功後(および 既に 作成済みの ケース)は user_metadata.pending_solo を クリア。
 *   冪等: 再訪しても API が 既存メンバーを 弾く ため 二重作成は 起きない。
 */
type Props = {
  plan: "solo" | "solo_pro";
  cycle: "monthly" | "yearly";
  organizationName?: string;
};

export function SoloCompleteClient({ plan, cycle, organizationName }: Props) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // Strict Mode の 二重実行を 抑止
    started.current = true;

    const clearPending = async () => {
      try {
        await createClient().auth.updateUser({ data: { pending_solo: null } });
      } catch {
        // クリア失敗は 無視(冪等なので 再訪しても API が 弾く)。
      }
    };

    (async () => {
      try {
        const res = await fetch("/api/self-serve/create-solo-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            cycle,
            ...(organizationName ? { organizationName } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          message?: string;
          redirectTo?: string;
          checkoutUrl?: string | null;
        };

        if (res.ok && body.ok) {
          await clearPending();
          const dest = body.checkoutUrl || body.redirectTo || "/agency?welcome=1";
          window.location.href = dest;
          return;
        }

        // 既に メンバー(= 既に 作成済み)の ケースは 完了扱いで /agency へ。
        if (body.error === "already_member") {
          await clearPending();
          window.location.href = "/agency";
          return;
        }

        // それ以外(has_seeker_data / 各種 500)は 画面に エラーを 出す。
        setError(body.message ?? body.error ?? `プラン開始に失敗しました (HTTP ${res.status})`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "不明なエラーが発生しました。");
      }
    })();
  }, [plan, cycle, organizationName]);

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        {error ? (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">プランの開始に失敗しました</h1>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <div className="flex flex-col gap-2">
              {/* 再試行は /signup/solo ではなく この完了ページを 再読込する。
                  ログイン済み + pending_solo が 残っている ため、再読込で org 作成を
                  もう一度 試せる(/signup/solo に 戻すと「既に登録済」で 詰む)。 */}
              <Button className="w-full" render={<Link href="/signup/solo/complete" />}>
                もう一度試す
              </Button>
              <Button variant="outline" className="w-full" render={<Link href="/agency" />}>
                ダッシュボードへ
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <Loader2 className="text-muted-foreground size-12 animate-spin" />
            </div>
            <h1 className="text-xl font-bold">プランを準備しています…</h1>
            <p className="text-muted-foreground text-sm">
              メールアドレスの確認が完了しました。個人ワークスペースを作成しています。このまま少々お待ちください。
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
