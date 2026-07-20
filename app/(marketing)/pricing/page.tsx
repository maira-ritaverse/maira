/**
 * /pricing - 料金プラン LP
 *
 * Solo (個人事業主 / フリー CA) と Team (2-10人の紹介会社) の 4 プランを
 * 一覧比較 + FAQ + CTA。 Solo は セルフサーブ導線 (/signup/solo)、 Team は
 * 商談 / 問合せ導線 (/contact) に誘導。
 *
 * 意図的にシンプルなレイアウト。プラン数=4で、決定に必要な情報を
 * 1画面に収める (RoiPage の学びから)。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Check, Sparkles, X } from "lucide-react";

import { SOLO_MONTHLY_PRICE } from "@/lib/billing/agency";
import { BrandMark } from "@/components/features/marketing/brand-mark";
import { SiteFooter } from "@/components/features/marketing/site-footer";
import { SiteHeader } from "@/components/features/marketing/site-header";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "料金プラン | Maira",
  description:
    "Maira の料金プラン一覧。個人事業主向け Solo (¥5,980/月) から 5 人までの Team Growth (¥45,000/月) まで、稼働規模に合わせて選べます。",
};

type FeatureRow = {
  label: string;
  values: [boolean | string, boolean | string, boolean | string, boolean | string]; // Solo, Solo Pro, Team Starter, Team Growth
  category?: "core" | "team" | "support";
};

const FEATURE_ROWS: FeatureRow[] = [
  { label: "求職者 CRM (管理 / 検索)", values: [true, true, true, true], category: "core" },
  { label: "求人管理 + PDF AI 取込", values: [true, true, true, true], category: "core" },
  { label: "AI 求人推薦 (マッチング)", values: [true, true, true, true], category: "core" },
  { label: "AI 書類生成 (履歴書 / 職経)", values: [true, true, true, true], category: "core" },
  { label: "推薦文 AI 下書き", values: [true, true, true, true], category: "core" },
  {
    label: "元書類 → プロフィール AI 反映",
    values: [true, true, true, true],
    category: "core",
  },
  {
    label: "AI 証明写真 (自撮り → 履歴書用)",
    values: ["月5回", "月10回", "月5回", "月5回"],
    category: "core",
  },
  {
    label: "公式 LINE 連携 + AI 返信案",
    values: [true, true, true, true],
    category: "core",
  },
  {
    label: "面談録音 → AI 議事録",
    values: [false, "月5回", "月50回", "月50回"],
    category: "core",
  },
  {
    label: "レポート (KPI / 成約率 / トレンド)",
    values: ["個人のみ", "個人+詳細PDF", "アドバイザー別", "フル"],
    category: "core",
  },
  { label: "メンバー招待 / 追加席", values: [false, false, true, true], category: "team" },
  {
    label: "ロール管理 (admin / advisor)",
    values: [false, false, true, true],
    category: "team",
  },
  {
    label: "CSV 一括インポート / エクスポート",
    values: [false, true, true, true],
    category: "team",
  },
  {
    label: "MA (Flow / Segment 自動配信)",
    values: [false, false, true, true],
    category: "team",
  },
  {
    label: "メールサポート応答 SLA",
    values: ["48時間以内", "24時間以内", "24時間以内", "12時間以内"],
    category: "support",
  },
  {
    label: "決済 / インボイス (適格請求書)",
    values: ["カード", "カード", "カード / 請求書", "カード / 請求書"],
    category: "support",
  },
  { label: "無料トライアル", values: ["14日", "14日", "30日", "30日"], category: "support" },
];

const PLAN_HEADERS: {
  key: string;
  label: string;
  subtitle: string;
  price: number | null;
  cycle: "月" | "月〜";
  seat: string;
  ai: string;
  cta: { label: string; href: string; primary: boolean };
  highlight?: boolean;
}[] = [
  {
    key: "solo",
    label: "Solo",
    subtitle: "個人事業主 / フリーの 1 席",
    price: SOLO_MONTHLY_PRICE.solo,
    cycle: "月",
    seat: "1 席",
    ai: "AI 月 100 回",
    cta: { label: "14日間無料で試す", href: "/signup/solo?plan=solo", primary: false },
  },
  {
    key: "solo_pro",
    label: "Solo Pro",
    subtitle: "本業として独立した CA",
    price: SOLO_MONTHLY_PRICE.solo_pro,
    cycle: "月",
    seat: "1 席",
    ai: "AI 月 200 回",
    cta: { label: "14日間無料で試す", href: "/signup/solo?plan=solo_pro", primary: true },
    highlight: true,
  },
  {
    key: "team_starter",
    label: "Team Starter",
    subtitle: "小規模紹介会社 (2-3 人)",
    price: 25000,
    cycle: "月〜",
    seat: "2-3 席",
    ai: "AI 月 500 回",
    cta: { label: "商談を予約", href: "/contact", primary: false },
  },
  {
    key: "team_growth",
    label: "Team Growth",
    subtitle: "5 人までの紹介会社",
    price: 45000,
    cycle: "月〜",
    seat: "4-5 席",
    ai: "AI 月 1,000 回",
    cta: { label: "商談を予約", href: "/contact", primary: false },
  },
];

type Faq = { q: string; a: string };
const FAQ: Faq[] = [
  {
    q: "Solo プランで 2 人目のメンバーを招待できますか?",
    a: "できません。Solo / Solo Pro は 1 席固定です。チームで使いたい場合は Team プランへアップグレードしてください。データは同じアカウントのまま引継ぎ可能です。",
  },
  {
    q: "AI 使用量 100 回 (Solo) の内訳は?",
    a: "全 kind の合算で月 100 回です (求人推薦 / 書類 AI 下書き / 推薦文 / LINE 返信案 等)。求人 PDF 取込や元書類抽出のような重い処理は 1 回=2 カウントで消費されます。通常業務では月 60-80 回に収まる想定です。",
  },
  {
    q: "個人事業主でもインボイス (適格請求書) は発行できますか?",
    a: "発行可能です。Stripe 経由で適格請求書対応の領収書が発行されます。T 番号は支払方法の設定で追加してください。",
  },
  {
    q: "求職者のデータは誰が所有しますか?",
    a: "Solo ユーザー本人に帰属します。退会時にエクスポート可能で、独立 / 会社化で Team プランに移行する場合も同一データを引継げます。",
  },
  {
    q: "有料職業紹介事業の許可が必要ですか?",
    a: "職業安定法上、有料職業紹介事業としての契約 / 手数料の授受には許可が必要です。Maira は業務ツールの提供のみで職業紹介自体は行いません。許可を持たない個人単独での業務は受け入れていません。",
  },
  {
    q: "支払いを月払いから年払いに変更できますか?",
    a: "できます。年払いは 10 ヶ月分の料金で 12 ヶ月使え、実質 2 ヶ月割引です。Stripe Customer Portal から切替てください。",
  },
  {
    q: "解約するとどうなりますか?",
    a: "月次更新なので「次回更新停止」を選ぶと今期の期末まで使えて課金停止されます。データは削除されず、再契約時に同じ状態から再開できます (退会は別途「アカウント削除」を選ぶ必要があります)。",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <main>
        {/* === Hero === */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8 lg:py-16">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
                <Sparkles className="size-3" />
                14 日間無料で全機能お試し
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
                稼働規模に合わせて選べる
                <br />
                <BrandMark />
                の料金プラン
              </h1>
              <p className="mt-5 text-base leading-relaxed text-slate-600 md:text-lg">
                個人事業主の 1 席から、5 人までの紹介会社まで。
                <br className="hidden md:block" />
                AI 込みの業務ツールを、チーム規模に合わせて段階的にお使いいただけます。
              </p>
            </div>
          </div>
        </section>

        {/* === プラン カード === */}
        <section className="border-b border-slate-200 bg-slate-50 py-14 lg:py-20">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {PLAN_HEADERS.map((p) => (
                <div
                  key={p.key}
                  className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${
                    p.highlight ? "border-orange-400 ring-2 ring-orange-100" : "border-slate-200"
                  }`}
                >
                  {p.highlight && (
                    <div className="mb-3 inline-flex w-fit items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                      <Sparkles className="size-3" />
                      おすすめ
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{p.label}</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">{p.subtitle}</p>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-slate-900">
                        ¥{p.price?.toLocaleString("ja-JP")}
                      </span>
                      <span className="text-muted-foreground text-sm">/ {p.cycle}</span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {p.seat} ・ {p.ai}
                    </p>
                  </div>
                  <div className="mt-6 flex-1" />
                  <Link
                    href={p.cta.href}
                    className={buttonVariants({
                      variant: p.cta.primary ? "default" : "outline",
                      size: "default",
                    })}
                  >
                    {p.cta.label}
                  </Link>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-6 text-center text-xs">
              表示価格は税別です。年払いは 10 ヶ月分の料金で 12 ヶ月使えます (2 ヶ月分割引)。
            </p>
          </div>
        </section>

        {/* === 機能 比較 表 === */}
        <section className="border-b border-slate-200 bg-white py-14 lg:py-20">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">機能比較</h2>
            <p className="mt-3 text-sm text-slate-600">
              全プラン共通の「コア機能」に加え、プラン別の差別化ポイントをまとめました。
            </p>

            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-4 py-3 text-left font-semibold text-slate-900">
                      機能
                    </th>
                    {PLAN_HEADERS.map((p) => (
                      <th
                        key={p.key}
                        className={`border-b px-4 py-3 text-center text-xs font-semibold ${
                          p.highlight
                            ? "border-orange-200 bg-orange-50 text-orange-800"
                            : "border-slate-200 text-slate-700"
                        }`}
                      >
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ROWS.map((row) => (
                    <tr key={row.label}>
                      <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 text-slate-700">
                        {row.label}
                      </td>
                      {row.values.map((v, idx) => (
                        <td
                          key={idx}
                          className={`border-b border-slate-100 px-4 py-3 text-center text-xs ${
                            PLAN_HEADERS[idx].highlight ? "bg-orange-50/60" : ""
                          }`}
                        >
                          {typeof v === "boolean" ? (
                            v ? (
                              <Check className="mx-auto size-4 text-orange-600" aria-hidden />
                            ) : (
                              <X className="text-muted-foreground/40 mx-auto size-4" aria-hidden />
                            )
                          ) : (
                            <span className="text-slate-700">{v}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* === FAQ === */}
        <section className="border-b border-slate-200 bg-slate-50 py-14 lg:py-20">
          <div className="mx-auto max-w-4xl px-5 lg:px-8">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">よくある質問</h2>
            <div className="mt-8 space-y-3">
              {FAQ.map((f, idx) => (
                <details
                  key={idx}
                  className="group rounded-lg border border-slate-200 bg-white p-4"
                >
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 marker:hidden">
                    <span className="mr-2 text-orange-600">Q.</span>
                    {f.q}
                  </summary>
                  <p className="mt-3 pl-6 text-sm leading-relaxed text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* === CTA === */}
        <section className="bg-white py-14 lg:py-20">
          <div className="mx-auto max-w-4xl px-5 text-center lg:px-8">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">まずは 14 日間無料で</h2>
            <p className="mt-3 text-sm text-slate-600 md:text-base">
              クレジットカードの登録は必要ですが、14 日間は課金されません。
              <br className="hidden md:block" />
              期間中に解約すれば一切費用はかかりません。
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup/solo?plan=solo"
                className={buttonVariants({ variant: "default", size: "lg" })}
              >
                Solo を試す (¥{SOLO_MONTHLY_PRICE.solo.toLocaleString("ja-JP")}/月)
              </Link>
              <Link
                href="/signup/solo?plan=solo_pro"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Solo Pro を試す (¥{SOLO_MONTHLY_PRICE.solo_pro.toLocaleString("ja-JP")}/月)
              </Link>
              <Link href="/contact" className={buttonVariants({ variant: "ghost", size: "lg" })}>
                Team は商談予約 →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
