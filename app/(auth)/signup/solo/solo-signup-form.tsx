"use client";

/**
 * Solo プラン セルフサーブ サインアップ フォーム。
 *
 * フロー:
 *   1. メール / パスワード / (任意) 表示名 で サインアップ
 *   2. supabase.auth.signUp で auth.users 作成 + セッション 発行
 *   3. POST /api/self-serve/create-solo-account を 叩き 個人 org + plan を 作成
 *   4. Stripe 設定済 → Checkout URL に redirect / 未設定 → /agency?welcome=1
 *
 * トライアル 14 日 の 案内 と、 Solo / Solo Pro の 切替 UI 付き。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

import { SOLO_MONTHLY_PRICE } from "@/lib/billing/agency";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

type SoloPlan = "solo" | "solo_pro";
type Cycle = "monthly" | "yearly";

type Props = {
  initialPlan: SoloPlan;
  initialCycle: Cycle;
};

const PLAN_LABEL: Record<SoloPlan, string> = {
  solo: "Solo",
  solo_pro: "Solo Pro",
};

const PLAN_DESCRIPTION: Record<SoloPlan, string> = {
  solo: "1 席 / AI 月 100 回 / メールサポート 48h 以内",
  solo_pro:
    "1 席 / AI 月 200 回 / CSV 一括 / 詳細レポート / 面談録音月 5 回 / メールサポート 24h 以内",
};

function fmtYen(v: number): string {
  return `¥${v.toLocaleString("ja-JP")}`;
}

function labelForCycle(plan: SoloPlan, cycle: Cycle): string {
  const monthly = SOLO_MONTHLY_PRICE[plan];
  if (cycle === "monthly") return `${fmtYen(monthly)} / 月 (税別)`;
  // yearly = 10 ヶ月分 (2 ヶ月割引)
  const yearly = monthly * 10;
  return `${fmtYen(yearly)} / 年 (税別、2 ヶ月分割引)`;
}

export function SoloSignupForm({ initialPlan, initialCycle }: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState<SoloPlan>(initialPlan);
  const [cycle, setCycle] = useState<Cycle>(initialCycle);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("パスワードは8文字以上で入力してください");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Supabase Auth で サインアップ
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // メール確認 は 現行 project 設定 に 依存。 確認あり の 場合 session は
          // 返らず、 メール 経由 で /auth/confirm → /signup/solo に 戻る 動線 が
          // 必要 に なる。 現状 は 「session が 返れば すぐ 個人 org 作成 に 進む」
          // と いう optimistic な 実装。 メール 未確認 な user から の 呼出 は
          // API 側 で auth.uid() が 取れず 401 で 弾かれる。
        },
      });
      if (signUpError) {
        // 「既に登録済のメール」は Supabase のエラーメッセージに "already" を
        // 含むことが多いので日本語に変換。
        const msg = signUpError.message.toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          setError("このメールアドレスは既に登録済です。ログインページからお進みください。");
        } else {
          setError(`サインアップに失敗しました: ${signUpError.message}`);
        }
        return;
      }

      // session が返っていない (メール確認が必要) 場合の案内
      if (!signUpData.session) {
        setError(
          "確認メールをお送りしました。メール内のリンクをクリックしてから再度このページにアクセスしてプランを開始してください。",
        );
        return;
      }

      // 2. 個人 org + プラン を 作成
      const res = await fetch("/api/self-serve/create-solo-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          cycle,
          ...(orgName.trim() ? { organizationName: orgName.trim() } : {}),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        redirectTo?: string;
        checkoutUrl?: string | null;
      };

      if (!res.ok || !body.ok) {
        setError(body.message ?? body.error ?? `プラン開始に失敗しました (HTTP ${res.status})`);
        return;
      }

      // 3. Stripe Checkout URL が あれば そこへ (checkoutUrl は 決済 導入前 は null)
      //    それ以外 は /agency?welcome=1 に 遷移
      const dest = body.checkoutUrl || body.redirectTo || "/agency?welcome=1";
      if (dest.startsWith("http")) {
        window.location.href = dest;
      } else {
        router.push(dest);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラーが発生しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/icon-192.png"
            alt="Myaira"
            width={64}
            height={64}
            priority
            className="size-16"
          />
          <div>
            <h1 className="text-2xl font-bold">Myaira Solo プランに登録</h1>
            <p className="text-muted-foreground mt-1 text-xs">
              14 日間無料でお試しいただけます (期間中の解約で課金なし)
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="bg-card space-y-4 rounded-lg border p-6">
          {/* プラン 選択 */}
          <div className="space-y-2">
            <Label>プラン</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["solo", "solo_pro"] as const).map((p) => {
                const active = plan === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlan(p)}
                    className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-input hover:border-primary/40"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="text-sm font-semibold">{PLAN_LABEL[p]}</div>
                    <div className="text-muted-foreground mt-1">{PLAN_DESCRIPTION[p]}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 支払いサイクル選択 */}
          <div className="space-y-2">
            <Label>支払いサイクル</Label>
            <div className="flex items-center gap-2">
              {(["monthly", "yearly"] as const).map((c) => {
                const active = cycle === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCycle(c)}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-input hover:border-primary/40"
                    }`}
                    aria-pressed={active}
                  >
                    {c === "monthly" ? "月払い" : "年払い (2 ヶ月分割引)"}
                  </button>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs">{labelForCycle(plan, cycle)}</p>
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">
              メールアドレス <span className="text-red-600">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password">
              パスワード <span className="text-red-600">*</span>
            </Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-muted-foreground text-xs">8 文字以上で入力してください</p>
          </div>

          {/* Organization Name (optional) */}
          <div className="space-y-2">
            <Label htmlFor="orgName">
              表示名 <span className="text-muted-foreground text-xs">(任意)</span>
            </Label>
            <Input
              id="orgName"
              type="text"
              placeholder="例: 山田太郎のワークスペース"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={isSubmitting}
              maxLength={100}
            />
            <p className="text-muted-foreground text-xs">
              未入力の場合はメールアドレスから自動生成されます
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "処理中…" : "14 日間無料で試す"}
          </Button>

          <p className="text-muted-foreground text-center text-xs">
            登録すると{" "}
            <Link href="/terms" className="underline" target="_blank">
              利用規約
            </Link>{" "}
            と{" "}
            <Link href="/privacy" className="underline" target="_blank">
              プライバシーポリシー
            </Link>{" "}
            に同意したものとします。
          </p>
        </form>

        <p className="text-muted-foreground text-center text-xs">
          既にアカウントをお持ちの方は{" "}
          <Link href="/login" className="underline">
            ログイン
          </Link>
        </p>
      </div>
    </main>
  );
}
