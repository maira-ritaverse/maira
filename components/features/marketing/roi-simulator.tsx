"use client";

/**
 * /roi ページのシミュレーター本体。
 *
 * - 数値入力 → リアルタイムで年間効果額が更新
 * - 提出ボタンで /api/marketing/roi-simulation に POST → DB 保存 + メール通知
 * - 提出後は自動返信メールの案内を表示
 *
 * 動き:
 *   ・年間効果額が 0 → 最終値にカウントアップ (requestAnimationFrame)
 *   ・入力値が変わるたびに 600ms かけて滑らかに再アニメート
 *
 * 入力は type=text + 数字フィルター。「自由に大きな数字を入れたい」要望
 * (上限なし、ホイールで値が変わらない、step に縛られない) に応じている。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  calculateRoi,
  DEFAULT_ROI_INPUT,
  ROI_ASSUMPTIONS_DESCRIPTION,
  type RoiInput,
} from "@/lib/marketing/roi";

type Status = "idle" | "submitting" | "success" | "error";

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

const NUMERIC_FIELDS: Array<{
  key: keyof RoiInput;
  label: string;
  suffix: string;
  hint?: string;
}> = [
  { key: "advisorCount", label: "アドバイザー数", suffix: "名" },
  { key: "monthlyClients", label: "月間対応求職者数", suffix: "名 / 月" },
  { key: "docMinutesPerCase", label: "履歴書/職経1件あたり作成時間", suffix: "分" },
  { key: "monthlyDeals", label: "月間成約件数", suffix: "件 / 月" },
  { key: "avgFeeManYen", label: "平均紹介料単価", suffix: "万円 / 件" },
  { key: "monthlyLostLeads", label: "連絡漏れで取りこぼし案件", suffix: "件 / 月" },
  {
    key: "advisorHourlyYen",
    label: "アドバイザー平均時給",
    suffix: "円",
    hint: "月給50万 ≒ 時給3,000円",
  },
];

export function RoiSimulator() {
  const [input, setInput] = useState<RoiInput>(DEFAULT_ROI_INPUT);
  // text 入力 として 表示 する 文字列 ( 編集 中 の 「空文字」 や 桁 区切り を 保持 できる )
  const [textValues, setTextValues] = useState<Record<keyof RoiInput, string>>(() => ({
    advisorCount: String(DEFAULT_ROI_INPUT.advisorCount),
    monthlyClients: String(DEFAULT_ROI_INPUT.monthlyClients),
    docMinutesPerCase: String(DEFAULT_ROI_INPUT.docMinutesPerCase),
    monthlyDeals: String(DEFAULT_ROI_INPUT.monthlyDeals),
    avgFeeManYen: String(DEFAULT_ROI_INPUT.avgFeeManYen),
    monthlyLostLeads: String(DEFAULT_ROI_INPUT.monthlyLostLeads),
    advisorHourlyYen: String(DEFAULT_ROI_INPUT.advisorHourlyYen),
  }));

  const [company, setCompany] = useState({
    companyName: "",
    contactName: "",
    email: "",
    role: "",
    phone: "",
    industry: "",
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const result = useMemo(() => calculateRoi(input), [input]);

  // 数字 カウントアップ アニメーション
  const [animatedTotal, setAnimatedTotal] = useState(result.yearly.total);
  const prevTotalRef = useRef(result.yearly.total);
  useEffect(() => {
    const from = prevTotalRef.current;
    const to = result.yearly.total;
    const duration = 600;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedTotal(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else prevTotalRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [result.yearly.total]);

  // 数字 のみ 受け付け、 上限 なし。 カンマ や 半角 / 全角 数字 が 混ざっても 拾う。
  const handleNumericChange = (key: keyof RoiInput, raw: string) => {
    // 全角 数字 (U+FF10-FF19) → 半角 に 正規 化。
    // 注意: 範囲 を `/[0-9]/g` と 書くと 半角 数字 が 対象 に なって 壊れる。
    // 全角 範囲 は `[０-９]`。
    const half = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    // 数字 のみ 抽出 ( カンマ / 空白 等 は 捨てる )
    const digits = half.replace(/[^0-9]/g, "");
    setTextValues((prev) => ({ ...prev, [key]: digits }));
    const n = digits === "" ? 0 : Number(digits);
    setInput((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : 0 }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.companyName || !company.contactName || !company.email) {
      setErrorMessage("会社名・担当者名・メールアドレスは必須です");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/marketing/roi-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: company.companyName,
          contactName: company.contactName,
          email: company.email,
          role: company.role || null,
          phone: company.phone || null,
          industry: company.industry || null,
          advisorCount: input.advisorCount,
          monthlyClients: input.monthlyClients,
          monthlyDeals: input.monthlyDeals,
          avgFeeManYen: input.avgFeeManYen,
          docMinutesPerCase: input.docMinutesPerCase,
          monthlyLostLeads: input.monthlyLostLeads,
          advisorHourlyYen: input.advisorHourlyYen,
          website: "", // honeypot
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "送信に失敗しました");
      }

      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "送信に失敗しました");
      setStatus("error");
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
      {/* === 入力側 === */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 会社情報 */}
        <section className="bg-card rounded-lg border p-6">
          <h2 className="mb-4 text-lg font-bold">会社情報</h2>
          <div className="space-y-4">
            <Field label="会社名" required>
              <Input
                value={company.companyName}
                onChange={(e) => setCompany((p) => ({ ...p, companyName: e.target.value }))}
                placeholder="株式会社◯◯"
                required
                maxLength={200}
              />
            </Field>
            <Field label="担当者名" required>
              <Input
                value={company.contactName}
                onChange={(e) => setCompany((p) => ({ ...p, contactName: e.target.value }))}
                placeholder="山田太郎"
                required
                maxLength={120}
              />
            </Field>
            <Field label="メールアドレス" required>
              <Input
                type="email"
                value={company.email}
                onChange={(e) => setCompany((p) => ({ ...p, email: e.target.value }))}
                placeholder="example@yourcompany.co.jp"
                required
                maxLength={320}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="役職">
                <Input
                  value={company.role}
                  onChange={(e) => setCompany((p) => ({ ...p, role: e.target.value }))}
                  placeholder="経営者 / 人事部長 等"
                  maxLength={80}
                />
              </Field>
              <Field label="電話番号">
                <Input
                  value={company.phone}
                  onChange={(e) => setCompany((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="06-XXXX-XXXX"
                  maxLength={40}
                />
              </Field>
            </div>
            <Field label="業種 / 専門領域">
              <Input
                value={company.industry}
                onChange={(e) => setCompany((p) => ({ ...p, industry: e.target.value }))}
                placeholder="IT / 医療 / 製造 等"
                maxLength={80}
              />
            </Field>
          </div>
        </section>

        {/* 業務数値 */}
        <section className="bg-card rounded-lg border p-6">
          <h2 className="mb-1 text-lg font-bold">あなたの会社の現状</h2>
          <p className="text-muted-foreground mb-4 text-xs">
            数字を入れると右側の試算がその場で更新されます
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {NUMERIC_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <div className="flex items-baseline gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={textValues[f.key]}
                    onChange={(e) => handleNumericChange(f.key, e.target.value)}
                    className="max-w-32"
                  />
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {f.suffix}
                  </span>
                </div>
              </Field>
            ))}
          </div>
        </section>

        {/* 提出 */}
        <section>
          {status === "success" ? (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="size-4 text-green-700" />
              <AlertDescription className="text-green-800">
                試算結果を{company.email}にお送りしました。営業担当からも1営業日以内にご連絡します。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Button type="submit" size="lg" className="w-full" disabled={status === "submitting"}>
                {status === "submitting" ? "送信中..." : "この試算結果を受け取る"}
                <ArrowRight className="ml-1 size-4" />
              </Button>
              {errorMessage && (
                <Alert variant="destructive" className="mt-3">
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <p className="text-muted-foreground mt-3 text-xs">
                送信すると試算結果がメールで届き、営業担当から詳細資料を1営業日以内にお送りします。
              </p>
            </>
          )}
        </section>

        {/* honeypot ( hidden ) */}
        <div className="hidden" aria-hidden>
          <label>
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
              onChange={() => {}}
            />
          </label>
        </div>
      </form>

      {/* === 結果側 === */}
      <aside className="space-y-5 self-start lg:sticky lg:top-24">
        <div className="relative overflow-hidden rounded-xl border border-orange-200 bg-linear-to-br from-orange-50 to-orange-100 p-8 shadow-sm">
          <p className="text-sm font-medium text-orange-700">あなたの会社の場合</p>
          <p className="my-3 text-5xl font-bold tracking-tight text-orange-600 tabular-nums">
            {yen(animatedTotal)}
          </p>
          <p className="text-sm text-orange-900/80">の年間効果が期待できます</p>
          <div
            aria-hidden
            className="absolute -right-8 -bottom-8 size-32 rounded-full bg-orange-300/30 blur-2xl"
          />
        </div>

        <div className="bg-card space-y-3 rounded-lg border p-6 text-sm">
          <h3 className="text-sm font-bold">年間効果の内訳</h3>
          <Row label="書類作成時間短縮" value={yen(result.yearly.docTimeSavings)} />
          <Row label="連絡漏れ防止" value={yen(result.yearly.leadRecovery)} />
          <Row label="面談リマインダーで成約UP" value={yen(result.yearly.dealUplift)} />
        </div>

        <div className="bg-card rounded-lg border p-6 text-sm">
          <h3 className="mb-3 text-sm font-bold">月ベースの改善</h3>
          <div className="space-y-2 text-slate-700">
            <p>
              <span className="font-medium">書類作成時間:</span>{" "}
              <span className="text-slate-500 line-through">
                月{Math.round(result.monthly.docHoursBefore)}時間
              </span>{" "}
              →{" "}
              <span className="font-bold text-slate-900">
                月{Math.round(result.monthly.docHoursAfter)}時間
              </span>
            </p>
            <p>
              <span className="font-medium">機会損失回避:</span>{" "}
              <span className="font-bold text-slate-900">
                {yen(result.monthly.leadRecoveryYen)} / 月
              </span>
            </p>
            <p>
              <span className="font-medium">1人あたり対応可能数:</span>{" "}
              <span className="text-slate-500">
                {Math.round(result.capacity.currentPerAdvisor)}名
              </span>{" "}
              →{" "}
              <span className="font-bold text-slate-900">
                {Math.round(result.capacity.afterMairaPerAdvisor)}名
              </span>
            </p>
          </div>
        </div>

        <details className="text-muted-foreground rounded-lg border bg-slate-50 px-4 py-3 text-xs">
          <summary className="cursor-pointer font-medium text-slate-700">計算前提を見る</summary>
          <ul className="mt-2 ml-4 list-disc space-y-1">
            {ROI_ASSUMPTIONS_DESCRIPTION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </aside>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="font-bold text-slate-900 tabular-nums">{value}</span>
    </div>
  );
}
