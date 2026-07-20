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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadError(null);
      setLoading(true);
      // 未 ログイン (session なし) は /login に 戻す
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (userErr) {
        setLoadError("認証状態の確認に失敗しました。時間をおいて再度お試しください。");
        setLoading(false);
        return;
      }
      if (!user) {
        router.replace(nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : "/login");
        return;
      }

      // ★既 に AAL2 な ら 再チャレンジ 不要 → next へ 直行 (bookmark 直撃 対策)
      try {
        const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal.error) throw aal.error;
        if (aal.data?.currentLevel === "aal2") {
          router.replace(safeNextOr(nextParam, "/app"));
          return;
        }
      } catch {
        setLoadError("認証状態の確認に失敗しました。ネットワークを確認して再度お試しください。");
        setLoading(false);
        return;
      }

      // ★factor 取得 も エラー を 区別: 「本当 に 無い」 のか 「取得 失敗」 なのか
      let listRes;
      try {
        listRes = await supabase.auth.mfa.listFactors();
      } catch {
        setLoadError("認証要素の取得に失敗しました。ネットワークを確認して再度お試しください。");
        setLoading(false);
        return;
      }
      if (listRes.error) {
        setLoadError(`認証要素の取得に失敗しました: ${listRes.error.message}`);
        setLoading(false);
        return;
      }
      const verified = (listRes.data?.all ?? []).find(
        (f) => f.factor_type === "totp" && f.status === "verified",
      );
      if (!verified) {
        // 「本当 に 無い」 = 直リンク 等 の 想定 外 な の で 通常 フロー に 戻す
        router.replace(safeNextOr(nextParam, "/app"));
        return;
      }
      if (cancelled) return;
      setFactorId(verified.id);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, router, nextParam, reloadKey]);

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

          {loadError ? (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
              <Button
                variant="outline"
                onClick={() => setReloadKey((n) => n + 1)}
                className="w-full"
              >
                再試行
              </Button>
            </div>
          ) : loading ? (
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
