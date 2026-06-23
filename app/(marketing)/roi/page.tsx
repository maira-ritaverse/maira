/**
 * /roi  - ROI 試算 ページ
 *
 * 「ROI だけ では 寂しい」 要望 を 受け、 シミュレーター だけ で なく
 *   1. Hero (問いかけ + 価値提案)
 *   2. ROI シミュレーター
 *   3. 効果を生む 3 つの機能
 *   4. 導入効果の数字 (ベンチマーク)
 *   5. CTA (トップの資料請求へ)
 * の構成で構築。動きは CSS animation + Intersection Observer 風の
 * delay 付き fade-in で軽量に。
 */
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Clock,
  FileText,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import { BrandMark } from "@/components/features/marketing/brand-mark";
import { RoiSimulator } from "@/components/features/marketing/roi-simulator";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "ROI試算 | Maira",
  description:
    "現状の数字を入力するだけで、Maira導入後の年間効果額をその場で試算。経営会議や社内検討にお役立ていただけます。",
};

export default function RoiPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      {/* === Hero === */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8 lg:py-16">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" />
            トップに戻る
          </Link>

          <div className="mt-6 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
              <Sparkles className="size-3" />
              入力30秒で効果を可視化
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
              <BrandMark />
              を導入すると、
              <br />
              年間でどれだけ変わるか。
            </h1>
            <p className="mt-5 text-base leading-relaxed text-slate-600 md:text-lg">
              現状の数字を入力するだけで、削減時間と売上効果がその場で計算されます。
              <br className="hidden md:block" />
              経営会議や社内検討で「どのくらい効くか」を数字で議論する材料に。
            </p>
          </div>
        </div>
      </section>

      {/* === シミュレーター === */}
      <section id="simulator" className="border-b border-slate-200 py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="lp-fade-in mb-10 max-w-2xl">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">あなたの会社で試算</h2>
            <p className="mt-3 text-sm text-slate-600">
              入力値はデフォルトで中堅エージェント企業の一般的な値が入っています。ご自身の数字に書き換えてください。
            </p>
          </div>
          <div className="lp-fade-in" style={{ animationDelay: "120ms" }}>
            <RoiSimulator />
          </div>
        </div>
      </section>

      {/* === 効果を生む3つの機能 === */}
      <section className="bg-white py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="lp-fade-in mb-12 max-w-2xl">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              この効果を支える
              <BrandMark />
              の3つの機能
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              試算で計上している効果は、すべてMairaの実機能に紐付いています。
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              icon={FileText}
              title="AI履歴書/職経自動生成"
              description="会議録音をアップロードするだけで、履歴書/職務経歴書/推薦文をAIが構造化して出力。1件30分→5分へ。"
              metric="83%"
              metricLabel="作成時間削減"
              delay={0}
            />
            <FeatureCard
              icon={Bell}
              title="Dailyダイジェスト+沈黙アラート"
              description="毎朝8時に「今日やること」を1通のメールで配信。30/60/90日連絡なしの顧客を自動ハイライトし、取りこぼしを防止。"
              metric="80%"
              metricLabel="連絡漏れ削減"
              delay={100}
            />
            <FeatureCard
              icon={MessageSquare}
              title="面談リマインダー+候補日提案"
              description="面談24h前/1h前に自動リマインド。LINEで候補日を一括提案→求職者選択でMeet/Zoom URLが自動発行。"
              metric="+5%"
              metricLabel="成約率向上"
              delay={200}
            />
          </div>
        </div>
      </section>

      {/* === 数字で見る効果(ベンチマーク) === */}
      <section className="border-y border-slate-200 bg-slate-100 py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="lp-fade-in mb-12 max-w-2xl">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              <BrandMark />
              導入で実現する数字
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              既存導入先の平均値を元にした期待値です(業務形態により変動)。
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-4">
            <StatCard
              icon={Clock}
              value="83%"
              label="書類作成時間削減"
              sub="30分→5分 / 件"
              delay={0}
            />
            <StatCard
              icon={Users}
              value="2倍"
              label="1人あたり対応可能数"
              sub="50名→100名"
              delay={80}
            />
            <StatCard
              icon={Bell}
              value="80%"
              label="連絡漏れ削減"
              sub="Dailyダイジェスト効果"
              delay={160}
            />
            <StatCard
              icon={TrendingUp}
              value="+5%"
              label="成約率向上"
              sub="リマインダー効果"
              delay={240}
            />
          </div>
        </div>
      </section>

      {/* === Footer CTA === */}
      <section className="bg-white py-14 lg:py-20">
        <div className="mx-auto max-w-3xl px-5 text-center lg:px-8">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
            まずは
            <BrandMark />
            を体験してみませんか?
          </h2>
          <p className="mt-4 text-sm text-slate-600">
            試算結果を元に、ご利用に合った詳細資料とデモをご案内します。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/#cta" className={buttonVariants({ size: "lg" })}>
              資料を請求する
            </Link>
            <Link href="/contact" className={buttonVariants({ size: "lg", variant: "outline" })}>
              直接相談する
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

// ===================== サブコンポーネント =====================

function FeatureCard({
  icon: Icon,
  title,
  description,
  metric,
  metricLabel,
  delay = 0,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  metric: string;
  metricLabel: string;
  delay?: number;
}) {
  return (
    <div
      className="lp-fade-in bg-card flex flex-col gap-4 rounded-xl border border-slate-200 p-6 transition hover:-translate-y-1 hover:shadow-md"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
        <Icon className="size-5" />
      </div>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-600">{description}</p>
      <div className="mt-auto border-t border-slate-100 pt-4">
        <p className="text-2xl font-bold text-orange-600">{metric}</p>
        <p className="text-xs text-slate-500">{metricLabel}</p>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  sub,
  delay = 0,
}: {
  icon: typeof Clock;
  value: string;
  label: string;
  sub: string;
  delay?: number;
}) {
  return (
    <div
      className="lp-fade-in bg-card rounded-xl border border-slate-200 p-6"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Icon className="mb-3 size-5 text-orange-500" />
      <p className="text-3xl font-bold text-slate-900 md:text-4xl">{value}</p>
      <p className="mt-2 text-sm font-medium text-slate-700">{label}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}
