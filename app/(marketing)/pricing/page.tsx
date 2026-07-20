/**
 * /pricing - 料金プラン LP
 *
 * Solo (個人事業主 / フリー CA) と Team (2-10 人 の 紹介会社) の 4 プラン を
 * 一覧 比較 + FAQ + CTA。 Solo は セルフサーブ 導線 (/signup/solo) 、 Team は
 * 商談 / 問合せ 導線 (/contact) に 誘導。
 *
 * 意図 的 に シンプル な レイアウト。 プラン 数 = 4 で、 決定 に 必要 な 情報 を
 * 1 画面 に 収める (RoiPage の 学び から)。
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
    "Maira の 料金 プラン 一覧。 個人事業主 向け Solo (¥5,980/月) から 5 人 まで の Team Growth (¥45,000/月) まで、 稼働 規模 に 合わせて 選べます。",
};

type FeatureRow = {
  label: string;
  values: [boolean | string, boolean | string, boolean | string, boolean | string]; // Solo, Solo Pro, Team Starter, Team Growth
  category?: "core" | "team" | "support";
};

const FEATURE_ROWS: FeatureRow[] = [
  { label: "求職者 CRM (管理 / 検索)", values: [true, true, true, true], category: "core" },
  { label: "求人 管理 + PDF AI 取込", values: [true, true, true, true], category: "core" },
  { label: "AI 求人推薦 (マッチング)", values: [true, true, true, true], category: "core" },
  { label: "AI 書類 生成 (履歴書 / 職経)", values: [true, true, true, true], category: "core" },
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
    label: "面談 録音 → AI 議事録",
    values: [false, "月5回", "月50回", "月50回"],
    category: "core",
  },
  {
    label: "レポート (KPI / 成約率 / トレンド)",
    values: ["個人 のみ", "個人 + 詳細 PDF", "アドバイザー別", "フル"],
    category: "core",
  },
  { label: "メンバー招待 / 追加席", values: [false, false, true, true], category: "team" },
  {
    label: "ロール管理 (admin / advisor)",
    values: [false, false, true, true],
    category: "team",
  },
  {
    label: "CSV 一括 インポート / エクスポート",
    values: [false, true, true, true],
    category: "team",
  },
  {
    label: "MA (Flow / Segment 自動配信)",
    values: [false, false, true, true],
    category: "team",
  },
  {
    label: "メール サポート 応答 SLA",
    values: ["48 時間 以内", "24 時間 以内", "24 時間 以内", "12 時間 以内"],
    category: "support",
  },
  {
    label: "決済 / インボイス (適格請求書)",
    values: ["カード", "カード", "カード / 請求書", "カード / 請求書"],
    category: "support",
  },
  { label: "無料 トライアル", values: ["14 日", "14 日", "30 日", "30 日"], category: "support" },
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
    subtitle: "個人事業主 / フリー の 1 席",
    price: SOLO_MONTHLY_PRICE.solo,
    cycle: "月",
    seat: "1 席",
    ai: "AI 月 100 回",
    cta: { label: "14 日間 無料 で 試す", href: "/signup/solo?plan=solo", primary: false },
  },
  {
    key: "solo_pro",
    label: "Solo Pro",
    subtitle: "本業 として 独立 した CA",
    price: SOLO_MONTHLY_PRICE.solo_pro,
    cycle: "月",
    seat: "1 席",
    ai: "AI 月 200 回",
    cta: { label: "14 日間 無料 で 試す", href: "/signup/solo?plan=solo_pro", primary: true },
    highlight: true,
  },
  {
    key: "team_starter",
    label: "Team Starter",
    subtitle: "小規模 紹介会社 (2-3 人)",
    price: 25000,
    cycle: "月〜",
    seat: "2-3 席",
    ai: "AI 月 500 回",
    cta: { label: "商談 を 予約", href: "/contact", primary: false },
  },
  {
    key: "team_growth",
    label: "Team Growth",
    subtitle: "5 人 まで の 紹介会社",
    price: 45000,
    cycle: "月〜",
    seat: "4-5 席",
    ai: "AI 月 1,000 回",
    cta: { label: "商談 を 予約", href: "/contact", primary: false },
  },
];

type Faq = { q: string; a: string };
const FAQ: Faq[] = [
  {
    q: "Solo プラン で 2 人目 の メンバー を 招待 できますか?",
    a: "できません。 Solo / Solo Pro は 1 席 固定 です。 チーム で 使いたい 場合 は Team プラン へ アップグレード して ください。 データ は 同じ アカウント の まま 引継 ぎ 可能 です。",
  },
  {
    q: "AI 使用量 100 回 (Solo) の 内訳 は?",
    a: "全 kind の 合算 で 月 100 回 です (求人推薦 / 書類 AI 下書き / 推薦文 / LINE 返信案 等)。 求人 PDF 取込 や 元書類 抽出 の よう な 重い 処理 は 1 回 = 2 カウント で 消費 され ます。 通常 業務 で は 月 60-80 回 に 収まる 想定 です。",
  },
  {
    q: "個人事業主 で も インボイス (適格請求書) は 発行 できますか?",
    a: "発行 可能 です。 Stripe 経由 で 適格請求書 対応 の 領収書 が 発行 されます。 T 番号 は 支払方法 の 設定 で 追加 して ください。",
  },
  {
    q: "求職者 の データ は 誰 が 所有 しますか?",
    a: "Solo ユーザー 本人 に 帰属 します。 退会 時 に エクスポート 可能 で、 独立 / 会社化 で Team プラン に 移行 する 場合 も 同一 データ を 引継 げ ます。",
  },
  {
    q: "有料職業紹介事業 の 許可 が 必要 ですか?",
    a: "職業安定法 上、 有料 職業紹介 事業 と して の 契約 / 手数料 の 授受 に は 許可 が 必要 です。 Maira は 業務ツール の 提供 のみ で 職業紹介 自体 は 行いません。 許可 を 持たない 個人 単独 で の 業務 は 受け入れて いません。",
  },
  {
    q: "支払い を 月払い から 年払い に 変更 できますか?",
    a: "できます。 年払い は 10 ヶ月 分 の 料金 で 12 ヶ月 使え、 実質 2 ヶ月 割引 です。 Stripe Customer Portal から 切替 て ください。",
  },
  {
    q: "解約 する と どうなり ますか?",
    a: "月次 更新 な の で 「次回 更新 停止」を 選ぶ と 今 期 の 期末 まで 使えて 課金 停止 され ます。 データ は 削除 されず、 再 契約 時 に 同じ 状態 から 再開 でき ます (退会 は 別途 「アカウント 削除」を 選ぶ 必要 が あり ます)。",
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
                14 日間 無料 で 全機能 お試し
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
                稼働 規模 に 合わせて 選べる
                <br />
                <BrandMark />の 料金 プラン
              </h1>
              <p className="mt-5 text-base leading-relaxed text-slate-600 md:text-lg">
                個人事業主 の 1 席 から、 5 人 まで の 紹介会社 まで。
                <br className="hidden md:block" />
                AI 込み の 業務ツール を、 チーム 規模 に 合わせて 段階 的 に お使い いただけます。
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
              表示 価格 は 税別 です。 年払い は 10 ヶ月 分 の 料金 で 12 ヶ月 使えます (2 ヶ月 分
              割引)。
            </p>
          </div>
        </section>

        {/* === 機能 比較 表 === */}
        <section className="border-b border-slate-200 bg-white py-14 lg:py-20">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">機能 比較</h2>
            <p className="mt-3 text-sm text-slate-600">
              全プラン 共通 の 「コア 機能」 に 加え、 プラン 別 の 差別化 ポイント を
              まとめました。
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
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">よくある 質問</h2>
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
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              まず は 14 日間 無料 で
            </h2>
            <p className="mt-3 text-sm text-slate-600 md:text-base">
              クレジット カード の 登録 は 必要 ですが、 14 日 間 は 課金 されません。
              <br className="hidden md:block" />
              期間中 に 解約 すれば 一切 費用 は かかり ません。
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup/solo?plan=solo"
                className={buttonVariants({ variant: "default", size: "lg" })}
              >
                Solo を 試す (¥{SOLO_MONTHLY_PRICE.solo.toLocaleString("ja-JP")}/月)
              </Link>
              <Link
                href="/signup/solo?plan=solo_pro"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Solo Pro を 試す (¥{SOLO_MONTHLY_PRICE.solo_pro.toLocaleString("ja-JP")}/月)
              </Link>
              <Link href="/contact" className={buttonVariants({ variant: "ghost", size: "lg" })}>
                Team は 商談 予約 →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
