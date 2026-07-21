"use client";

/**
 * MFA (二段階 認証 TOTP) の 登録 / 解除 UI。
 *
 * 使用 場所: /app/settings/security, /agency/settings/security (両者 共通)。
 *
 * 状態 遷移:
 *   ・factors が 空 or unverified のみ = 「有効化 ボタン」 → enroll → QR 表示
 *     → 認証 アプリ に 追加 → コード 入力 → verify → 完了
 *   ・verified factor が 1 件 以上 = 「削除 ボタン」 で unenroll
 *
 * 保存 場所: Supabase Auth の auth.mfa_factors (アプリ 側 の 独自 テーブル 不要)。
 *
 * 認証 アプリ: TOTP RFC 6238 準拠 の どの アプリ でも 動く
 * (Google Authenticator / 1Password / Authy / Microsoft Authenticator 等)。
 */
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { listUserFactors, type MfaFactorSummary } from "@/lib/auth/mfa";

type EnrollState =
  | { kind: "idle" }
  | {
      kind: "enrolling";
      factorId: string;
      qrCode: string;
      secret: string;
      uri: string;
    };

export function MfaPanel() {
  const router = useRouter();
  const supabase = useState(() => createClient())[0];

  const [factors, setFactors] = useState<MfaFactorSummary[] | null>(null);
  const [enroll, setEnroll] = useState<EnrollState>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = async () => {
    setFactors(await listUserFactors(supabase));
  };

  useEffect(() => {
    // 初回 マウント で ユーザー の 現 factor 一覧 を 引く。
    // cancelled flag で 迅速 な unmount 時 の setState 発火 を 防ぐ。
    let cancelled = false;
    void (async () => {
      const list = await listUserFactors(supabase);
      if (!cancelled) setFactors(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const startEnroll = async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      // ★friendlyName に time + 短い random suffix を 付与 (同日 の 複数 enroll で
      //   Supabase の per-user friendly_name uniqueness に 衝突 する の を 回避、
      //   セキュリティ 監査 MFA #8)。
      //   secondary: 別 タブ で 進行 中 の enroll が あって も 名前 衝突 で 弾か れない。
      const stamp =
        new Date().toLocaleString("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }) + `-${Math.floor(Math.random() * 10000).toString(36)}`;
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Myaira (${stamp})`,
      });
      if (enrollErr || !data) {
        throw new Error(enrollErr?.message ?? "enroll_failed");
      }
      if (data.type !== "totp") {
        throw new Error("expected_totp");
      }
      setEnroll({
        kind: "enrolling",
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "有効化を開始できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (enroll.kind !== "enrolling") return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const { data: chData, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: enroll.factorId,
      });
      if (chErr || !chData) throw new Error(chErr?.message ?? "challenge_failed");
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: chData.id,
        code: code.trim(),
      });
      if (verifyErr) throw new Error(verifyErr.message);
      setSuccess("二段階認証を有効化しました。次回のログイン時からコードの入力が必要になります。");
      setEnroll({ kind: "idle" });
      setCode("");
      await refresh();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? `コードが一致しません: ${err.message}` : "コードが一致しません",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelEnroll = async () => {
    if (enroll.kind !== "enrolling") return;
    setBusy(true);
    try {
      await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
    } catch {
      // 掃除 失敗 は 握る (次回 enroll 時 に 再 unenroll される)
    }
    setEnroll({ kind: "idle" });
    setCode("");
    setBusy(false);
    await refresh();
  };

  const removeFactor = async (factorId: string) => {
    if (
      !confirm(
        "二段階認証を解除しますか?\nセキュリティが下がります。第三者にパスワードを知られた場合、そのままログインを許してしまいます。",
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId });
      if (unErr) throw new Error(unErr.message);
      setSuccess("二段階認証を解除しました。");
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const verified = (factors ?? []).filter((f) => f.status === "verified");

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-base font-semibold">二段階認証 (MFA)</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          パスワードに加えて、認証アプリが生成する 6
          桁のコードでログインを保護します。パスワードが漏れても第三者はアカウントに入れなくなります。
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription className="text-emerald-800">{success}</AlertDescription>
        </Alert>
      )}

      {factors === null ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : verified.length > 0 ? (
        <div className="space-y-3">
          <div className="rounded border bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            二段階認証は<span className="font-semibold">有効</span>です。
          </div>
          <div className="rounded border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2">名前</th>
                  <th className="px-3 py-2">種別</th>
                  <th className="px-3 py-2">登録日</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {verified.map((f) => (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-2 text-xs">{f.friendlyName ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{f.factorType.toUpperCase()}</td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(f.createdAt).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void removeFactor(f.id)}
                        disabled={busy}
                      >
                        解除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : enroll.kind === "idle" ? (
        <div>
          <Button onClick={() => void startEnroll()} disabled={busy}>
            {busy ? "処理中…" : "二段階認証を有効化する"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold">
              1. 認証アプリで下記の QR コードを読み取ってください
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              対応アプリ: Google Authenticator / 1Password / Authy / Microsoft Authenticator など
              TOTP 標準対応のもの
            </p>
            <div className="mt-3 inline-block rounded border bg-white p-3">
              <Image src={enroll.qrCode} alt="MFA QR コード" width={200} height={200} unoptimized />
            </div>
          </div>

          <div>
            <p className="text-muted-foreground text-xs">
              QR を読めない場合は、次の秘密鍵を手入力:
            </p>
            <code className="bg-muted mt-1 block rounded p-2 text-xs break-all">
              {enroll.secret}
            </code>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mfa-code">2. 認証アプリに表示される 6 桁のコードを入力</Label>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="max-w-32 tracking-widest"
              disabled={busy}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => void verifyCode()} disabled={busy || code.length !== 6}>
              {busy ? "確認中…" : "確認して有効化"}
            </Button>
            <Button variant="outline" onClick={() => void cancelEnroll()} disabled={busy}>
              キャンセル
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
