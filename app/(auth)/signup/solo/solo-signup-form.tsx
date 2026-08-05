"use client";

/**
 * Solo プラン セルフサーブ サインアップ フォーム。
 *
 * フロー(メール確認必須でも別端末で完結):
 *   1. startSoloSignup(server action)が 未確認ユーザーを 作成し、登録意図(plan /
 *      cycle / 表示名)を user_metadata に 保存 → Resend で 確認メール送信
 *      (/auth/confirm?type=signup&next=/signup/solo/complete)
 *   2. 確認リンク(別端末OK)を 開くと 確認 + ログイン → /signup/solo/complete が
 *      個人 org + プランを 自動作成 → Stripe Checkout / /agency へ
 *
 * トライアル 14 日 の 案内 と、 Solo / Solo Pro の 切替 UI 付き。
 */
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { startSoloSignup } from "@/app/auth/actions";
import { SOLO_MONTHLY_PRICE } from "@/lib/billing/agency";
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
  const [plan, setPlan] = useState<SoloPlan>(initialPlan);
  const [cycle, setCycle] = useState<Cycle>(initialCycle);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 確認メール送信済み(送信後の 案内ブロックに 切り替える)。
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsConfirm(false);

    if (password.length < 8) {
      setError("パスワードは8文字以上で入力してください");
      return;
    }

    setIsSubmitting(true);
    try {
      // 未確認ユーザー作成 + 意図保存 + 確認メール送信(server action)。
      // 実際の org 作成は 確認リンク → /signup/solo/complete で 自動実行される。
      const result = await startSoloSignup({
        email,
        password,
        plan,
        cycle,
        organizationName: orgName.trim() || undefined,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNeedsConfirm(true);
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

        {needsConfirm ? (
          <div className="bg-card space-y-4 rounded-lg border p-6 text-sm">
            <Alert>
              <AlertDescription>
                {email || "ご入力のメールアドレス"}{" "}
                宛に確認メールをお送りしました。メール内のリンクを開くだけで登録が完了し、そのままプランが始まります(別のスマホ
                / パソコンで開いても大丈夫です)。このページに戻る必要はありません。
              </AlertDescription>
            </Alert>
            <p className="text-muted-foreground text-xs">
              メールが届かない /
              リンクの有効期限が切れた場合は、下の「入力に戻る」からもう一度送信すると再送されます。
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setNeedsConfirm(false)}
            >
              入力に戻る
            </Button>
          </div>
        ) : (
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
        )}

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
