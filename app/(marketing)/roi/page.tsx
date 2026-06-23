/**
 * /roi  - ROI 試算 ページ
 *
 * 「ROI だけ では 寂しい」 要望 を 受け、 シミュレーター だけ で なく
 *   1. Hero ( 問いかけ + 価値 提案 )
 *   2. ROI シミュレーター
 *   3. 効果 を 生む 3 つ の 機能
 *   4. 導入 効果 の 数字 ( ベンチマーク )
 *   5. CTA ( トップ の 資料 請求 へ )
 * の 構成 で 構築。 動き は CSS animation + Intersection Observer 風 の
 * delay 付き fade-in で 軽量 に。
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
  title: "ROI 試算 | Maira",
  description:
    "現状 の 数字 を 入力 する だけ で、 Maira 導入 後 の 年間 効果 額 を その場 で 試算。 経営 会議 や 社内 検討 に お役立て いただけます。",
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
            トップ に 戻る
          </Link>

          <div className="mt-6 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
              <Sparkles className="size-3" />
              入力 30 秒 で 効果 を 可視 化
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
              <BrandMark /> を 導入 する と、
              <br />
              年間 で どれ だけ 変わる か。
            </h1>
            <p className="mt-5 text-base leading-relaxed text-slate-600 md:text-lg">
              現状 の 数字 を 入力 する だけ で、 削減 時間 と 売上 効果 が その場 で 計算
              されます。
              <br className="hidden md:block" />
              経営 会議 や 社内 検討 で 「どの くらい 効くか」 を 数字 で 議論 する 材料 に。
            </p>
          </div>
        </div>
      </section>

      {/* === シミュレーター === */}
      <section id="simulator" className="border-b border-slate-200 py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="lp-fade-in mb-10 max-w-2xl">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              あなた の 会社 で 試算
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              入力 値 は デフォルト で 中堅 エージェント 企業 の 一般 的 な 値 が 入って います。
              ご自身 の 数字 に 書き換え て ください。
            </p>
          </div>
          <div className="lp-fade-in" style={{ animationDelay: "120ms" }}>
            <RoiSimulator />
          </div>
        </div>
      </section>

      {/* === 効果 を 生む 3 つ の 機能 === */}
      <section className="bg-white py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="lp-fade-in mb-12 max-w-2xl">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              この 効果 を 支える <BrandMark /> の 3 つ の 機能
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              試算 で 計上 して いる 効果 は、 すべて Maira の 実 機能 に 紐 付いて います。
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              icon={FileText}
              title="AI 履歴 書 / 職経 自動 生成"
              description="会議 録音 を アップロード する だけ で、 履歴 書 / 職務 経歴 書 / 推薦 文 を AI が 構造 化 して 出力。 1 件 30 分 → 5 分 へ。"
              metric="83%"
              metricLabel="作成 時間 削減"
              delay={0}
            />
            <FeatureCard
              icon={Bell}
              title="Daily ダイジェスト + 沈黙 アラート"
              description="毎朝 8 時 に 「今日 やる こと」 を 1 通 の メール で 配信。 30/60/90 日 連絡 なし の 顧客 を 自動 ハイライト し、 取りこぼし を 防止。"
              metric="80%"
              metricLabel="連絡 漏れ 削減"
              delay={100}
            />
            <FeatureCard
              icon={MessageSquare}
              title="面談 リマインダー + 候補 日 提案"
              description="面談 24h 前 / 1h 前 に 自動 リマインド。 LINE で 候補 日 を 一括 提案 → 求職者 選択 で Meet/Zoom URL が 自動 発行。"
              metric="+5%"
              metricLabel="成約 率 向上"
              delay={200}
            />
          </div>
        </div>
      </section>

      {/* === 数字 で 見る 効果 ( ベンチマーク ) === */}
      <section className="border-y border-slate-200 bg-slate-100 py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <div className="lp-fade-in mb-12 max-w-2xl">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              <BrandMark /> 導入 で 実現 する 数字
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              既存 導入 先 の 平均 値 を 元 に した 期待 値 です。 ( 業務 形態 に より 変動 )
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-4">
            <StatCard
              icon={Clock}
              value="83%"
              label="書類 作成 時間 削減"
              sub="30 分 → 5 分 / 件"
              delay={0}
            />
            <StatCard
              icon={Users}
              value="2 倍"
              label="1 人 あたり 対応 可能 数"
              sub="50 名 → 100 名"
              delay={80}
            />
            <StatCard
              icon={Bell}
              value="80%"
              label="連絡 漏れ 削減"
              sub="Daily ダイジェスト 効果"
              delay={160}
            />
            <StatCard
              icon={TrendingUp}
              value="+5%"
              label="成約 率 向上"
              sub="リマインダー 効果"
              delay={240}
            />
          </div>
        </div>
      </section>

      {/* === Footer CTA === */}
      <section className="bg-white py-14 lg:py-20">
        <div className="mx-auto max-w-3xl px-5 text-center lg:px-8">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
            まずは <BrandMark /> を 体験 して みません か?
          </h2>
          <p className="mt-4 text-sm text-slate-600">
            試算 結果 を 元 に、 ご利用 に 合った 詳細 資料 と デモ を ご案内 します。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/#cta" className={buttonVariants({ size: "lg" })}>
              資料 を 請求 する
            </Link>
            <Link href="/contact" className={buttonVariants({ size: "lg", variant: "outline" })}>
              直接 相談 する
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

// ===================== サブ コンポーネント =====================

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
