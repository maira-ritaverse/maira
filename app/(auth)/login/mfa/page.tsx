"use client";

/**
 * /login/mfa
 *
 * パスワード ログイン 直後 (AAL1 セッション) の ユーザー が verified TOTP factor
 * を 持って いる 場合 に 遷移 する ページ。 認証 アプリ の 6 桁 コード を
 * 入力 → verify → セッション を AAL2 に 昇格 → next (or /app) へ redirect。
 *
 * middleware で 「verified factor を 持って いる が session が aal1 の 場合、
 * このページ 以外 は アクセス 禁止」 と ガード される (無限 ループ を 避けるため
 * このページ 自身 は 除外)。
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextOr } from "@/lib/auth/safe-next";
import { getFirstVerifiedTotpFactorId } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/client";

export default function MfaChallengePage() {
  // useSearchParams が SSR 側 で 例外 を 投げ ない よう Suspense 境界 で ラップ。
  return (
    <Suspense
      fallback={
        <main className="bg-background flex min-h-screen items-center justify-center p-4">
          <p className="text-muted-foreground text-sm">読み込み中…</p>
        </main>
      }
    >
      <MfaChallengeInner />
    </Suspense>
  );
}

function MfaChallengeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const supabase = useMemo(() => createClient(), []);

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      // 未 ログイン (session なし) は /login に 戻す
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : "/login");
        return;
      }
      // verified factor が 無い の に この ページ に 来た = 何 か 異常 (直リンク 等)。
      // 通常 フロー に 戻す。
      const fid = await getFirstVerifiedTotpFactorId(supabase);
      if (!fid) {
        router.replace(safeNextOr(nextParam, "/app"));
        return;
      }
      setFactorId(fid);
      setLoading(false);
    })();
  }, [supabase, router, nextParam]);

  const submit = async () => {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { data: chData, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !chData) throw new Error(chErr?.message ?? "challenge_failed");
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: chData.id,
        code: code.trim(),
      });
      if (verifyErr) throw new Error(verifyErr.message);
      // 昇格 成功 → next へ
      router.replace(safeNextOr(nextParam, "/app"));
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? `コードが一致しません: ${err.message}` : "コードが一致しません",
      );
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Card className="space-y-4 p-6">
          <div>
            <h1 className="text-2xl font-bold">二段階認証</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              認証アプリに表示される 6 桁のコードを入力してください。
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <p className="text-muted-foreground text-sm">読み込み中…</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="mfa-code">6 桁のコード</Label>
                <Input
                  id="mfa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456"
                  className="text-center text-lg tracking-[0.5em]"
                  disabled={busy}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                {busy ? "確認中…" : "確認"}
              </Button>
            </form>
          )}
        </Card>
        <p className="text-muted-foreground text-center text-xs">
          認証アプリを紛失した場合はサポート (support@maira.pro) までご連絡ください。
        </p>
      </div>
    </main>
  );
}
