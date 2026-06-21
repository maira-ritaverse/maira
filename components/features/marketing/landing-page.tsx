/**
 * Maira ランディング ページ (新 構成、 SVG モック 内蔵)
 *
 * 目標: 「実 画面 で 何 が できる か」 を 一目 で 伝え、 資料 請求 を 獲得 する。
 *
 * セクション:
 *   1. Header
 *   2. Hero (キャッチ + ダッシュボード モック)
 *   3. 業界 の 痛み (Pain)
 *   4. 全 体 像 (Overview)
 *   5. Feature: クライアント CRM
 *   6. Feature: 公式 LINE 連携
 *   7. Feature: カレンダー + Zoom/Meet
 *   8. Feature: AI 履歴書 / 推薦文 自動 生成
 *   9. Feature: Daily ダイジェスト
 *  10. Security
 *  11. CTA: 資料 請求 フォーム
 *  12. FAQ
 *  13. Footer
 *
 * 画像 の 用意 方針 (= ユーザー 要望):
 *   ・SVG モック を デフォルト で 表示 (= スクショ 不要 で 即 公開 可能)
 *   ・後 で public/marketing/*.png に 実 スクリーン ショット を 配置 すれば
 *     <ScreenshotOrMock src="..." fallback={<Mock />} /> 内 で 差し替え 可能
 */
import {
  Bell,
  CheckCircle2,
  FileText,
  Lock,
  type LucideIcon,
  MessageSquare,
  Shield,
  Sparkles,
  Workflow,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { LeadRequestForm } from "./lead-request-form";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Header />
      <main>
        <Hero />
        <PainSection />
        <OverviewSection />
        <FeatureCrm />
        <FeatureLine />
        <FeatureCalendar />
        <FeatureAiDocument />
        <FeatureDigest />
        <SecuritySection />
        <CtaSection />
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}

/* ============================================================
 * Header
 * ============================================================ */

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="Maira トップ">
          <Image src="/icon-192.png" alt="" width={32} height={32} priority className="size-8" />
          <span className="text-lg font-bold tracking-tight">Maira</span>
          <span className="text-muted-foreground ml-1 text-[10px] tracking-[0.2em] uppercase">
            for agencies
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/login"
            className="hidden text-sm text-slate-600 hover:text-slate-900 sm:inline"
          >
            ログイン
          </Link>
          <a
            href="#cta"
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <FileText className="size-3.5" aria-hidden />
            資料 請求
          </a>
        </nav>
      </div>
    </header>
  );
}

/* ============================================================
 * Hero
 * ============================================================ */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-slate-50 to-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[1fr_1.2fr] lg:items-center lg:gap-16 lg:px-8 lg:py-28">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <Sparkles className="size-3" aria-hidden />
            転職 エージェント 業務 効率 化 SaaS
          </div>
          <h1 className="text-4xl leading-[1.2] font-bold tracking-tight sm:text-5xl">
            エージェント 業務 を、
            <br />
            <span className="text-emerald-600">AI で 一人 3 倍 速 に</span>
          </h1>
          <p className="text-base leading-relaxed text-slate-600 sm:text-lg">
            クライアント 管理・公式 LINE 連携・カレンダー 同期・推薦文 AI 下書き ・進捗 管理 まで、
            日々 の 業務 を 1 つ の 画面 で 完結。 取りこぼし を 朝の ダイジェスト で 防ぎ ます。
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="#cta"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-600"
            >
              <FileText className="size-4" aria-hidden />
              資料 を 請求 する (無料)
            </a>
            <a
              href="#features"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              機能 を 見る →
            </a>
          </div>
          <ul className="grid grid-cols-2 gap-2 pt-2 text-xs text-slate-600">
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              テスト 導入 1 ヶ月 無料
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              初期 セット アップ 30 分
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              データ 移行 サポート
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              解約 時 データ エクスポート
            </li>
          </ul>
        </div>
        <ScreenshotFrame caption="ダッシュボード: 今日 期限 の タスク と 沈黙 顧客 を 一目 で">
          <DashboardMock />
        </ScreenshotFrame>
      </div>
    </section>
  );
}

/* ============================================================
 * Pain points
 * ============================================================ */

function PainSection() {
  const pains: { icon: LucideIcon; title: string; body: string }[] = [
    {
      icon: Bell,
      title: "対応 忘れ で 機会 損失",
      body: "顧客 が 100 人 を 超える と、 連絡 漏れ が 月 数件 出る",
    },
    {
      icon: FileText,
      title: "書類 作成 が 時間 を 食う",
      body: "履歴書・推薦文 を 1 件 30 分 かけて 手 書き して いる",
    },
    {
      icon: MessageSquare,
      title: "LINE の 個別 対応 が 限界",
      body: "属人 化 して 担当 不在 時 に 返信 が 止まる",
    },
    {
      icon: Workflow,
      title: "進捗 管理 が 表計算 任せ",
      body: "Excel が 増殖 し、 誰 が 何 を やった か わから ない",
    },
  ];
  return (
    <section className="border-y border-slate-100 bg-slate-50/50 py-20">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <p className="text-center text-xs font-semibold tracking-[0.2em] text-emerald-600 uppercase">
          こんな 困り事 ありませんか
        </p>
        <h2 className="mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">
          エージェント 業務 の 「あるある」 を AI で 解消
        </h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {pains.map((p) => (
            <div key={p.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <p.icon className="size-5 text-emerald-600" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Overview (1 枚 図)
 * ============================================================ */

function OverviewSection() {
  return (
    <section className="py-20" id="overview">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-600 uppercase">
            Maira の 全体 像
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            求職者 と エージェント を、 1 つ の ハブ で つなぐ
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600">
            求職者 から の LINE / Web 経由 の アクション を、 エージェント 業務 と シームレス に
            連携。 各 ハブ が AI で 連動 します。
          </p>
        </div>
        <div className="mt-12 overflow-hidden rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <OverviewDiagram />
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Feature sections (左右 交互)
 * ============================================================ */

function FeatureSection({
  id,
  badge,
  title,
  description,
  bullets,
  mock,
  reverse,
}: {
  id?: string;
  badge: string;
  title: string;
  description: string;
  bullets: string[];
  mock: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section
      id={id}
      className={`py-16 sm:py-20 ${reverse ? "bg-slate-50/50" : "bg-white"} border-t border-slate-100`}
    >
      <div
        className={`mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-8 ${
          reverse ? "lg:*:first:order-2" : ""
        }`}
      >
        <div className="space-y-5">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {badge}
          </span>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
          <p className="text-sm leading-relaxed text-slate-600 sm:text-base">{description}</p>
          <ul className="space-y-2">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <ScreenshotFrame>{mock}</ScreenshotFrame>
      </div>
    </section>
  );
}

function FeatureCrm() {
  return (
    <div id="features">
      <FeatureSection
        badge="クライアント 管理"
        title="求職者 を 「忘れない」 CRM"
        description="紹介 状況 / 沈黙 期間 / 重複 を 自動 検出。 タスク と 期限 で 「次 やる こと」 が 一目 で わかります。"
        bullets={[
          "30 / 60 / 90 日 沈黙 顧客 を 自動 ハイライト",
          "電話 / メール / 同名 で 重複 候補 を 自動 検出",
          "未入力 項目 を フィールド 別 に 可視 化",
          "カンバン / 一覧 / カード を ワン クリック 切替",
        ]}
        mock={<CrmMock />}
      />
    </div>
  );
}

function FeatureLine() {
  return (
    <FeatureSection
      badge="公式 LINE 連携"
      title="LINE で 100 名 を 一人 で さばく"
      description="公式 LINE と Maira を 直接 接続。 一斉 配信、 シナリオ 自動 化、 求人 共有 まで Maira 内 で 完結。"
      bullets={[
        "1 友達 単位 で メモ / タグ / 担当 者 割当",
        "テキスト / 求人 カード / 予約 リンク の 一斉 配信",
        "MA シナリオ (面談 リマインド・誕生日・登録 御礼) を 自動 配信",
        "短縮 URL で クリック / 応募 を 計測",
      ]}
      mock={<LineConversationMock />}
      reverse
    />
  );
}

function FeatureCalendar() {
  return (
    <FeatureSection
      badge="カレンダー + 会議 連携"
      title="LINE で 日程 候補 → Meet/Zoom が 自動 作成"
      description="エージェント が 候補 日 3 件 を 投げる だけ。 求職者 が タップ し た 瞬間 に 会議 URL が 発行 され、 双方 の カレンダー に 同期。"
      bullets={[
        "Google カレンダー / Zoom と OAuth 連携",
        "面談 24h / 1h 前 の 自動 リマインダー",
        "面談 記録 を AI で ヒアリング シート / 履歴 書 草案 化",
        "カレンダー 購読 URL で 個人 端末 でも 閲覧",
      ]}
      mock={<CalendarMock />}
    />
  );
}

function FeatureAiDocument() {
  return (
    <FeatureSection
      badge="AI 文書 生成"
      title="録音 を 流す だけ で 履歴 書 が できる"
      description="面談 録音 (Zoom / 手動 アップロード) を Whisper で 文字 起こし → Claude が 構造 化 → 履歴 書・職経歴書・推薦文 を 自動 ドラフト。"
      bullets={[
        "Whisper による 高 精度 文字 起こし",
        "Claude Sonnet 4.6 で 構造 化 抽出",
        "PDF (Puppeteer) で 厚労省 推奨 様式 を 出力",
        "編集 履歴 / バージョン 管理 で 安全 に 推敲",
      ]}
      mock={<AiDocumentMock />}
      reverse
    />
  );
}

function FeatureDigest() {
  return (
    <FeatureSection
      badge="プロアクティブ 伴走"
      title="毎朝 8 時、 「今日 やる こと」 が 1 通 で 届く"
      description="期限 切れ タスク・30 日 沈黙 顧客・進捗 停止 中 の 応募 を 集計 して、 admin に メール 配信。 0 件 の 朝 は 送ら ない の で 開封 率 を 維持。"
      bullets={[
        "個人 設定 で メール 全体 ON/OFF + 種類 別 ON/OFF",
        "アプリ 内 通知 も 連動 (LINE 受信、 興味 表明、 応募)",
        "「何 を いつまで に やる」 を Maira が 教えて くれる",
      ]}
      mock={<DigestMailMock />}
    />
  );
}

/* ============================================================
 * Security
 * ============================================================ */

function SecuritySection() {
  const items: { icon: LucideIcon; title: string; body: string }[] = [
    {
      icon: Lock,
      title: "AES-256-GCM 暗号 化",
      body: "会話・キャリア・タスク・応募 詳細 を サーバー サイド 暗号 化",
    },
    {
      icon: Shield,
      title: "RLS で 完全 テナント 分離",
      body: "Supabase RLS で 組織 を 跨いだ アクセス を 物理 的 に 不可",
    },
    {
      icon: CheckCircle2,
      title: "Webhook HMAC 検証",
      body: "LINE / Stripe / Zoom 等 全 webhook を HMAC-SHA256 で 署名 検証",
    },
    {
      icon: FileText,
      title: "運営 アクセス 範囲 明示",
      body: "プライバシー ポリシー で 運営 の 閲覧 範囲 を 明文 化",
    },
  ];
  return (
    <section className="border-t border-slate-100 bg-slate-900 py-20 text-white">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
            Security
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            機密 情報 を 守る ため の 4 段 防御
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-300">
            求職者 の 個人 情報 と 採用 業務 の 機密 性 を 真剣 に 設計 して います。
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <div
              key={it.title}
              className="rounded-lg border border-white/10 bg-white/5 p-5 backdrop-blur"
            >
              <it.icon className="size-5 text-emerald-300" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold">{it.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * CTA (Lead form)
 * ============================================================ */

function CtaSection() {
  return (
    <section id="cta" className="bg-linear-to-br from-emerald-600 to-emerald-700 py-20 text-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_1.2fr] lg:items-start lg:gap-16 lg:px-8">
        <div className="space-y-5">
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-200 uppercase">
            Get started
          </p>
          <h2 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            まず は 1 ヶ月 無料 で
            <br />
            お試し ください
          </h2>
          <p className="text-sm leading-relaxed text-white/90 sm:text-base">
            お申し込み 後、 1 営業 日 以内 に 担当 から 資料 PDF と セット アップ 手順 を お送り
            します。 機能 制限 なし の フル 機能 を 1 ヶ月 ご利用 いただけ ます。
          </p>
          <ul className="space-y-2 pt-2 text-sm">
            {[
              "全 機能 を 1 ヶ月 無料 で 試せる",
              "初期 セット アップ 30 分 サポート",
              "CSV データ 移行 サポート",
              "解約 時 データ エクスポート 保証",
            ].map((b) => (
              <li key={b} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-200" aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-white p-6 text-slate-900 shadow-2xl shadow-emerald-900/20 sm:p-8">
          <LeadRequestForm variant="light" />
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * FAQ
 * ============================================================ */

function FaqSection() {
  const faqs = [
    {
      q: "テスト 導入 中 の データ は 本番 で そのまま 使え ますか?",
      a: "はい。 テスト 中 に 入力 した データ は 本契約 後 そのまま 引き継がれ ます。 解約 時 は CSV / JSON で 一括 エクスポート 可能 です。",
    },
    {
      q: "求職者 へ の 公開 範囲 は コントロール でき ますか?",
      a: "求職者 が 個別 に 「連携 解除 申請」 で 開示 を 停止 でき、 猶予 期間 経過 で 自動 確定。 二段階 解除 で 業務 中断 を 防ぎ ます。",
    },
    {
      q: "LINE 連携 は どの 規模 まで 対応 でき ますか?",
      a: "LINE Messaging API の Light (5,000 通/月) から Pro まで 全 プラン に 対応。 配信 数 の 残量 は Maira 内 で 可視 化 されます。",
    },
    {
      q: "Google Meet / Zoom 連携 で カレンダー の 既存 予定 は 見え ますか?",
      a: "scope は最小限 (calendar.events) で、 Maira から 作成 した 予定 のみ 編集 / 削除 します。 既存 予定 は 読み取り ません。",
    },
    {
      q: "AI 利用 量 に 上限 は ありますか?",
      a: "月次 で 機能 別 の 上限 が あり、 アドオン 契約 で 緩和 でき ます。 残量 は ダッシュボード で 常時 確認 可能 です。",
    },
    {
      q: "サポート の 連絡 手段 は?",
      a: "メール および フォーム から の お問い合わせ に、 1 営業 日 以内 に 一次 返信 します。",
    },
  ];
  return (
    <section className="border-t border-slate-100 bg-white py-20">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <p className="text-center text-xs font-semibold tracking-[0.2em] text-emerald-600 uppercase">
          FAQ
        </p>
        <h2 className="mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">
          よく ある ご質問
        </h2>
        <div className="mt-10 space-y-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-lg border border-slate-200 bg-white p-5 open:border-emerald-300"
            >
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 group-open:text-emerald-700">
                Q. {f.q}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Footer
 * ============================================================ */

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Image src="/icon-192.png" alt="" width={28} height={28} className="size-7" />
            <span className="text-base font-bold">Maira</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">
            転職 エージェント 業務 効率 化 SaaS
            <br />
            運営: maira-ritaverse
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            プロダクト
          </h3>
          <ul className="space-y-1.5">
            <li>
              <a href="#features" className="text-slate-600 hover:text-slate-900">
                機能
              </a>
            </li>
            <li>
              <a href="#cta" className="text-slate-600 hover:text-slate-900">
                資料 請求
              </a>
            </li>
            <li>
              <Link href="/login" className="text-slate-600 hover:text-slate-900">
                ログイン
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            サポート
          </h3>
          <ul className="space-y-1.5">
            <li>
              <Link href="/contact" className="text-slate-600 hover:text-slate-900">
                お問い合わせ
              </Link>
            </li>
            <li>
              <Link href="/support" className="text-slate-600 hover:text-slate-900">
                ヘルプ
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">法務</h3>
          <ul className="space-y-1.5">
            <li>
              <Link href="/privacy" className="text-slate-600 hover:text-slate-900">
                プライバシー ポリシー
              </Link>
            </li>
            <li>
              <Link href="/terms" className="text-slate-600 hover:text-slate-900">
                利用 規約
              </Link>
            </li>
            <li>
              <Link href="/legal" className="text-slate-600 hover:text-slate-900">
                特定 商取引 法
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-6xl border-t border-slate-200 px-5 pt-6 text-center text-xs text-slate-500 lg:px-8">
        &copy; {new Date().getFullYear()} Maira. All rights reserved.
      </div>
    </footer>
  );
}

/* ============================================================
 * 共通: スクリーン ショット フレーム
 * ============================================================ */

function ScreenshotFrame({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <figure className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
        </div>
        <div className="aspect-16/10 bg-white">{children}</div>
      </div>
      {caption && (
        <figcaption className="text-center text-[11px] text-slate-500">{caption}</figcaption>
      )}
    </figure>
  );
}

/* ============================================================
 * SVG モック 群 (= 実 スクリーン ショット に 差し替え 可能)
 * ============================================================ */

function DashboardMock() {
  return (
    <svg viewBox="0 0 800 500" className="h-full w-full" role="img" aria-label="ダッシュボード">
      <rect width="800" height="500" fill="#f8fafc" />
      <rect x="0" y="0" width="200" height="500" fill="#0f172a" />
      <text x="20" y="40" fontFamily="sans-serif" fontSize="14" fontWeight="700" fill="white">
        Maira
      </text>
      {[
        { y: 80, label: "ダッシュボード", active: true },
        { y: 110, label: "カレンダー" },
        { y: 140, label: "公式LINE" },
        { y: 170, label: "クライアント" },
        { y: 200, label: "求人管理" },
        { y: 230, label: "マーケティング" },
        { y: 260, label: "レポート" },
      ].map((m) => (
        <g key={m.label}>
          {m.active && <rect x="10" y={m.y - 14} width="180" height="22" rx="4" fill="#10b981" />}
          <text
            x="20"
            y={m.y}
            fontFamily="sans-serif"
            fontSize="11"
            fill={m.active ? "white" : "#cbd5e1"}
          >
            {m.label}
          </text>
        </g>
      ))}
      <text x="225" y="38" fontFamily="sans-serif" fontSize="16" fontWeight="700" fill="#0f172a">
        ダッシュボード
      </text>
      <text x="225" y="58" fontFamily="sans-serif" fontSize="10" fill="#64748b">
        2026/06/21(日) 今日 の 優先 タスク と KPI
      </text>
      {[
        { x: 225, label: "今日 期限", value: "3", color: "#ef4444" },
        { x: 365, label: "期限 超過", value: "1", color: "#f59e0b" },
        { x: 505, label: "沈黙 30日+", value: "12", color: "#8b5cf6" },
        { x: 645, label: "今月 紹介", value: "28", color: "#10b981" },
      ].map((c) => (
        <g key={c.label}>
          <rect x={c.x} y="80" width="130" height="80" rx="8" fill="white" stroke="#e2e8f0" />
          <text x={c.x + 12} y="105" fontFamily="sans-serif" fontSize="10" fill="#64748b">
            {c.label}
          </text>
          <text
            x={c.x + 12}
            y="140"
            fontFamily="sans-serif"
            fontSize="26"
            fontWeight="700"
            fill={c.color}
          >
            {c.value}
          </text>
        </g>
      ))}
      <rect x="225" y="180" width="550" height="260" rx="8" fill="white" stroke="#e2e8f0" />
      <text x="240" y="205" fontFamily="sans-serif" fontSize="12" fontWeight="600" fill="#0f172a">
        自分 の 今日 の タスク
      </text>
      {[
        { y: 232, t: "山田 太郎 様 / 求人 紹介 確認", due: "今日 17:00" },
        { y: 262, t: "佐藤 花子 様 / 一次 面接 結果 連絡", due: "今日 18:00" },
        { y: 292, t: "鈴木 一郎 様 / 履歴 書 添削", due: "明日 10:00" },
        { y: 322, t: "高橋 美咲 様 / 応募 ステータス 確認", due: "明日 14:00" },
      ].map((row) => (
        <g key={row.t}>
          <circle cx="245" cy={row.y} r="5" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
          <text x="260" y={row.y + 4} fontFamily="sans-serif" fontSize="11" fill="#334155">
            {row.t}
          </text>
          <text
            x="720"
            y={row.y + 4}
            fontFamily="sans-serif"
            fontSize="10"
            fill="#94a3b8"
            textAnchor="end"
          >
            {row.due}
          </text>
        </g>
      ))}
    </svg>
  );
}

function CrmMock() {
  return (
    <svg viewBox="0 0 800 500" className="h-full w-full" role="img" aria-label="クライアント 一覧">
      <rect width="800" height="500" fill="#f8fafc" />
      <rect x="0" y="0" width="800" height="50" fill="white" />
      <text x="20" y="32" fontFamily="sans-serif" fontSize="14" fontWeight="700" fill="#0f172a">
        クライアント 一覧
      </text>
      <rect x="600" y="14" width="180" height="22" rx="4" fill="#10b981" />
      <text x="690" y="29" fontFamily="sans-serif" fontSize="11" fill="white" textAnchor="middle">
        + 新規 登録
      </text>
      <rect x="20" y="70" width="760" height="50" rx="6" fill="#fef3c7" stroke="#fbbf24" />
      <text x="35" y="90" fontFamily="sans-serif" fontSize="11" fontWeight="600" fill="#92400e">
        ⚠ 対応 が 止まって いる 顧客 が 12 名 います
      </text>
      <text x="35" y="106" fontFamily="sans-serif" fontSize="10" fill="#92400e">
        30 日 以上 連絡 なし: 7 名 / 60 日 以上: 3 名 / 90 日 以上: 2 名
      </text>
      {[
        { y: 145, name: "山田 太郎", status: "面接 中", days: "2 日 前" },
        { y: 180, name: "佐藤 花子", status: "応募 待ち", days: "5 日 前" },
        { y: 215, name: "鈴木 一郎", status: "面談 予定", days: "今日" },
        { y: 250, name: "高橋 美咲", status: "面接 中", days: "1 日 前" },
        { y: 285, name: "伊藤 健太", status: "応募 待ち", days: "10 日 前" },
        { y: 320, name: "渡辺 さくら", status: "新規", days: "今日" },
        { y: 355, name: "中村 大輔", status: "面接 中", days: "3 日 前" },
        { y: 390, name: "小林 由美", status: "応募 待ち", days: "7 日 前" },
      ].map((r) => (
        <g key={r.name}>
          <rect x="20" y={r.y - 18} width="760" height="32" rx="4" fill="white" stroke="#e2e8f0" />
          <circle cx="38" cy={r.y - 2} r="10" fill="#cbd5e1" />
          <text
            x="58"
            y={r.y + 2}
            fontFamily="sans-serif"
            fontSize="11"
            fontWeight="500"
            fill="#0f172a"
          >
            {r.name}
          </text>
          <rect x="450" y={r.y - 12} width="70" height="18" rx="9" fill="#dcfce7" />
          <text
            x="485"
            y={r.y + 1}
            fontFamily="sans-serif"
            fontSize="9"
            fill="#15803d"
            textAnchor="middle"
          >
            {r.status}
          </text>
          <text
            x="760"
            y={r.y + 2}
            fontFamily="sans-serif"
            fontSize="10"
            fill="#94a3b8"
            textAnchor="end"
          >
            最終 対応 {r.days}
          </text>
        </g>
      ))}
    </svg>
  );
}

function LineConversationMock() {
  return (
    <svg viewBox="0 0 800 500" className="h-full w-full" role="img" aria-label="LINE 会話">
      <rect width="800" height="500" fill="#f8fafc" />
      <rect x="0" y="0" width="280" height="500" fill="white" />
      <text x="20" y="32" fontFamily="sans-serif" fontSize="14" fontWeight="700" fill="#0f172a">
        LINE トーク
      </text>
      {[
        { y: 70, name: "山田 太郎", preview: "ありがとう ござい ます", unread: 2 },
        { y: 130, name: "佐藤 花子", preview: "面接 の 件 で 連絡 です", unread: 0 },
        { y: 190, name: "鈴木 一郎", preview: "了解 しました", unread: 0 },
        { y: 250, name: "高橋 美咲", preview: "送って いただいた 求人...", unread: 1 },
      ].map((c) => (
        <g key={c.name}>
          <rect x="0" y={c.y - 25} width="280" height="56" fill="white" />
          <circle cx="25" cy={c.y} r="16" fill="#06c755" opacity="0.2" />
          <circle cx="25" cy={c.y} r="14" fill="#06c755" />
          <text
            x="55"
            y={c.y - 4}
            fontFamily="sans-serif"
            fontSize="12"
            fontWeight="600"
            fill="#0f172a"
          >
            {c.name}
          </text>
          <text x="55" y={c.y + 12} fontFamily="sans-serif" fontSize="10" fill="#64748b">
            {c.preview}
          </text>
          {c.unread > 0 && (
            <>
              <circle cx="260" cy={c.y} r="9" fill="#10b981" />
              <text
                x="260"
                y={c.y + 3}
                fontFamily="sans-serif"
                fontSize="10"
                fontWeight="700"
                fill="white"
                textAnchor="middle"
              >
                {c.unread}
              </text>
            </>
          )}
          <line x1="55" y1={c.y + 25} x2="280" y2={c.y + 25} stroke="#f1f5f9" />
        </g>
      ))}
      <rect x="280" y="0" width="520" height="50" fill="white" />
      <text x="300" y="32" fontFamily="sans-serif" fontSize="13" fontWeight="600" fill="#0f172a">
        山田 太郎 さん
      </text>
      <rect x="300" y="80" width="280" height="50" rx="14" fill="#e2e8f0" />
      <text x="315" y="100" fontFamily="sans-serif" fontSize="11" fill="#334155">
        本日 ご紹介 した 求人 ですが、
      </text>
      <text x="315" y="116" fontFamily="sans-serif" fontSize="11" fill="#334155">
        ぜひ 応募 し たい と 思い ます!
      </text>
      <rect x="430" y="160" width="350" height="60" rx="14" fill="#10b981" />
      <text x="445" y="180" fontFamily="sans-serif" fontSize="11" fill="white">
        承知 し ました! 面談 候補 日 を 3 件 お送り します。
      </text>
      <text x="445" y="196" fontFamily="sans-serif" fontSize="11" fill="white">
        2026/06/25 10:00、 6/26 14:00、 6/27 11:00
      </text>
      <text x="445" y="212" fontFamily="sans-serif" fontSize="11" fill="white">
        ご都合 の 良い 日時 を タップ ください。
      </text>
      <rect
        x="300"
        y="250"
        width="280"
        height="80"
        rx="14"
        fill="white"
        stroke="#06c755"
        strokeWidth="2"
      />
      <text x="315" y="275" fontFamily="sans-serif" fontSize="11" fontWeight="600" fill="#0f172a">
        6/25 (水) 10:00
      </text>
      <text x="315" y="293" fontFamily="sans-serif" fontSize="10" fill="#64748b">
        Google Meet で 開催
      </text>
      <rect x="315" y="305" width="80" height="22" rx="11" fill="#06c755" />
      <text x="355" y="320" fontFamily="sans-serif" fontSize="10" fill="white" textAnchor="middle">
        この 日時 で 確定
      </text>
    </svg>
  );
}

function CalendarMock() {
  const days = ["月", "火", "水", "木", "金", "土", "日"];
  return (
    <svg viewBox="0 0 800 500" className="h-full w-full" role="img" aria-label="カレンダー">
      <rect width="800" height="500" fill="#f8fafc" />
      <rect x="0" y="0" width="800" height="50" fill="white" />
      <text x="20" y="32" fontFamily="sans-serif" fontSize="14" fontWeight="700" fill="#0f172a">
        2026 年 6 月
      </text>
      {days.map((d, i) => (
        <g key={d}>
          <text
            x={50 + i * 105}
            y="80"
            fontFamily="sans-serif"
            fontSize="11"
            fontWeight="600"
            fill="#64748b"
            textAnchor="middle"
          >
            {d}
          </text>
        </g>
      ))}
      {[...Array(4)].map((_, row) =>
        [...Array(7)].map((__, col) => (
          <g key={`${row}-${col}`}>
            <rect
              x={10 + col * 105}
              y={95 + row * 100}
              width="100"
              height="95"
              fill="white"
              stroke="#e2e8f0"
            />
            <text
              x={20 + col * 105}
              y={110 + row * 100}
              fontFamily="sans-serif"
              fontSize="10"
              fill="#94a3b8"
            >
              {row * 7 + col + 1}
            </text>
          </g>
        )),
      )}
      <rect x="115" y="115" width="92" height="22" rx="3" fill="#10b981" />
      <text x="120" y="130" fontFamily="sans-serif" fontSize="9" fill="white">
        面談: 山田 様
      </text>
      <rect x="220" y="140" width="92" height="22" rx="3" fill="#06c755" />
      <text x="225" y="155" fontFamily="sans-serif" fontSize="9" fill="white">
        Meet: 佐藤 様
      </text>
      <rect x="430" y="215" width="92" height="22" rx="3" fill="#0ea5e9" />
      <text x="435" y="230" fontFamily="sans-serif" fontSize="9" fill="white">
        Zoom: 鈴木 様
      </text>
      <rect x="115" y="290" width="92" height="22" rx="3" fill="#10b981" />
      <text x="120" y="305" fontFamily="sans-serif" fontSize="9" fill="white">
        面談: 高橋 様
      </text>
      <rect x="640" y="315" width="92" height="22" rx="3" fill="#06c755" />
      <text x="645" y="330" fontFamily="sans-serif" fontSize="9" fill="white">
        Meet: 中村 様
      </text>
    </svg>
  );
}

function AiDocumentMock() {
  return (
    <svg viewBox="0 0 800 500" className="h-full w-full" role="img" aria-label="AI 文書 生成">
      <rect width="800" height="500" fill="#f8fafc" />
      <g transform="translate(40 60)">
        <rect width="200" height="380" rx="12" fill="white" stroke="#e2e8f0" />
        <circle cx="100" cy="80" r="40" fill="#fee2e2" />
        <circle cx="100" cy="80" r="32" fill="#ef4444" />
        <circle cx="100" cy="80" r="10" fill="white" />
        <text
          x="100"
          y="150"
          fontFamily="sans-serif"
          fontSize="12"
          fontWeight="600"
          fill="#0f172a"
          textAnchor="middle"
        >
          面談 録音
        </text>
        <text
          x="100"
          y="170"
          fontFamily="sans-serif"
          fontSize="10"
          fill="#64748b"
          textAnchor="middle"
        >
          interview.m4a
        </text>
        <text
          x="100"
          y="186"
          fontFamily="sans-serif"
          fontSize="10"
          fill="#64748b"
          textAnchor="middle"
        >
          45 分
        </text>
        <text
          x="100"
          y="280"
          fontFamily="sans-serif"
          fontSize="14"
          fill="#94a3b8"
          textAnchor="middle"
        >
          →
        </text>
        <rect x="40" y="310" width="120" height="50" rx="8" fill="#f0fdf4" stroke="#10b981" />
        <text
          x="100"
          y="332"
          fontFamily="sans-serif"
          fontSize="11"
          fontWeight="600"
          fill="#10b981"
          textAnchor="middle"
        >
          Whisper
        </text>
        <text
          x="100"
          y="348"
          fontFamily="sans-serif"
          fontSize="9"
          fill="#15803d"
          textAnchor="middle"
        >
          文字 起こし
        </text>
      </g>
      <g transform="translate(290 60)">
        <rect width="200" height="380" rx="12" fill="white" stroke="#e2e8f0" />
        <rect x="20" y="20" width="160" height="180" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
        {[...Array(8)].map((_, i) => (
          <rect
            key={i}
            x="30"
            y={35 + i * 20}
            width={i % 2 === 0 ? 140 : 100}
            height="6"
            rx="2"
            fill="#cbd5e1"
          />
        ))}
        <text
          x="100"
          y="225"
          fontFamily="sans-serif"
          fontSize="12"
          fontWeight="600"
          fill="#0f172a"
          textAnchor="middle"
        >
          テキスト
        </text>
        <text
          x="100"
          y="245"
          fontFamily="sans-serif"
          fontSize="10"
          fill="#64748b"
          textAnchor="middle"
        >
          (発話 + 時刻)
        </text>
        <text
          x="100"
          y="290"
          fontFamily="sans-serif"
          fontSize="14"
          fill="#94a3b8"
          textAnchor="middle"
        >
          →
        </text>
        <rect x="40" y="320" width="120" height="50" rx="8" fill="#eff6ff" stroke="#3b82f6" />
        <text
          x="100"
          y="342"
          fontFamily="sans-serif"
          fontSize="11"
          fontWeight="600"
          fill="#3b82f6"
          textAnchor="middle"
        >
          Claude AI
        </text>
        <text
          x="100"
          y="358"
          fontFamily="sans-serif"
          fontSize="9"
          fill="#1d4ed8"
          textAnchor="middle"
        >
          構造 化 抽出
        </text>
      </g>
      <g transform="translate(540 60)">
        <rect width="200" height="380" rx="12" fill="white" stroke="#10b981" strokeWidth="2" />
        <text
          x="100"
          y="40"
          fontFamily="sans-serif"
          fontSize="12"
          fontWeight="700"
          fill="#0f172a"
          textAnchor="middle"
        >
          履歴 書
        </text>
        <line x1="20" y1="55" x2="180" y2="55" stroke="#e2e8f0" />
        {[
          { y: 75, label: "氏名", value: "山田 太郎" },
          { y: 105, label: "学歴", value: "○○ 大学 卒業" },
          { y: 135, label: "職歴", value: "△△ 株式会社" },
          { y: 165, label: "資格", value: "TOEIC 850" },
          { y: 195, label: "志望", value: "成長 中 企業 で..." },
          { y: 225, label: "自己 PR", value: "課題 解決..." },
        ].map((row) => (
          <g key={row.label}>
            <text
              x="30"
              y={row.y}
              fontFamily="sans-serif"
              fontSize="9"
              fontWeight="600"
              fill="#475569"
            >
              {row.label}
            </text>
            <text x="80" y={row.y} fontFamily="sans-serif" fontSize="9" fill="#0f172a">
              {row.value}
            </text>
          </g>
        ))}
        <rect x="30" y="300" width="140" height="40" rx="6" fill="#10b981" />
        <text
          x="100"
          y="324"
          fontFamily="sans-serif"
          fontSize="11"
          fontWeight="600"
          fill="white"
          textAnchor="middle"
        >
          PDF を ダウンロード
        </text>
      </g>
    </svg>
  );
}

function DigestMailMock() {
  return (
    <svg viewBox="0 0 800 500" className="h-full w-full" role="img" aria-label="Daily ダイジェスト">
      <rect width="800" height="500" fill="#f1f5f9" />
      <rect x="100" y="40" width="600" height="420" rx="12" fill="white" stroke="#cbd5e1" />
      <rect x="100" y="40" width="600" height="60" rx="12" fill="#0f172a" />
      <text x="120" y="65" fontFamily="sans-serif" fontSize="11" fill="#94a3b8">
        From: Maira 運営 チーム - To: あなた
      </text>
      <text x="120" y="88" fontFamily="sans-serif" fontSize="14" fontWeight="700" fill="white">
        【Maira 朝の ダイジェスト】今日 3 件 / 超過 1 件 / 沈黙 12 件
      </text>
      <text x="130" y="130" fontFamily="sans-serif" fontSize="11" fill="#334155">
        山田 様
      </text>
      <text x="130" y="150" fontFamily="sans-serif" fontSize="10" fill="#64748b">
        2026/06/21 (日) の Maira ダイジェスト です。
      </text>
      <text x="130" y="185" fontFamily="sans-serif" fontSize="12" fontWeight="700" fill="#0f172a">
        ◆ 自分 宛 の タスク
      </text>
      <rect x="130" y="200" width="540" height="60" rx="6" fill="#fef2f2" stroke="#fecaca" />
      <text x="145" y="222" fontFamily="sans-serif" fontSize="11" fill="#991b1b">
        今日 期限: 3 件
      </text>
      <text x="145" y="242" fontFamily="sans-serif" fontSize="11" fill="#b91c1c">
        期限 超過: 1 件
      </text>
      <text x="130" y="295" fontFamily="sans-serif" fontSize="12" fontWeight="700" fill="#0f172a">
        ◆ 組織 全体 の 注意
      </text>
      <rect x="130" y="310" width="540" height="60" rx="6" fill="#fef3c7" stroke="#fde68a" />
      <text x="145" y="332" fontFamily="sans-serif" fontSize="11" fill="#92400e">
        30 日 沈黙 顧客: 12 件
      </text>
      <text x="145" y="352" fontFamily="sans-serif" fontSize="11" fill="#a16207">
        7 日 進捗 停止 応募: 5 件
      </text>
      <rect x="290" y="400" width="220" height="40" rx="20" fill="#10b981" />
      <text
        x="400"
        y="425"
        fontFamily="sans-serif"
        fontSize="12"
        fontWeight="600"
        fill="white"
        textAnchor="middle"
      >
        ダッシュボード を 開く
      </text>
    </svg>
  );
}

function OverviewDiagram() {
  return (
    <svg viewBox="0 0 900 320" className="w-full" role="img" aria-label="Maira の 全体 像">
      <g transform="translate(60 110)">
        <rect width="160" height="100" rx="12" fill="#dcfce7" stroke="#10b981" strokeWidth="2" />
        <text
          x="80"
          y="40"
          fontFamily="sans-serif"
          fontSize="14"
          fontWeight="700"
          fill="#064e3b"
          textAnchor="middle"
        >
          求職者
        </text>
        <text
          x="80"
          y="60"
          fontFamily="sans-serif"
          fontSize="10"
          fill="#065f46"
          textAnchor="middle"
        >
          LINE / Web
        </text>
        <text
          x="80"
          y="76"
          fontFamily="sans-serif"
          fontSize="10"
          fill="#065f46"
          textAnchor="middle"
        >
          スマホ で 完結
        </text>
      </g>
      <g transform="translate(370 80)">
        <rect width="160" height="160" rx="12" fill="#0f172a" />
        <text
          x="80"
          y="40"
          fontFamily="sans-serif"
          fontSize="18"
          fontWeight="700"
          fill="white"
          textAnchor="middle"
        >
          Maira
        </text>
        <text x="80" y="58" fontFamily="sans-serif" fontSize="9" fill="#94a3b8" textAnchor="middle">
          for agencies
        </text>
        <line x1="20" y1="75" x2="140" y2="75" stroke="#475569" />
        <text x="80" y="95" fontFamily="sans-serif" fontSize="9" fill="#10b981" textAnchor="middle">
          CRM
        </text>
        <text
          x="80"
          y="111"
          fontFamily="sans-serif"
          fontSize="9"
          fill="#10b981"
          textAnchor="middle"
        >
          LINE 連携
        </text>
        <text
          x="80"
          y="127"
          fontFamily="sans-serif"
          fontSize="9"
          fill="#10b981"
          textAnchor="middle"
        >
          カレンダー
        </text>
        <text
          x="80"
          y="143"
          fontFamily="sans-serif"
          fontSize="9"
          fill="#10b981"
          textAnchor="middle"
        >
          AI 文書 生成
        </text>
      </g>
      <g transform="translate(680 110)">
        <rect width="160" height="100" rx="12" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2" />
        <text
          x="80"
          y="40"
          fontFamily="sans-serif"
          fontSize="14"
          fontWeight="700"
          fill="#1e3a8a"
          textAnchor="middle"
        >
          エージェント
        </text>
        <text
          x="80"
          y="60"
          fontFamily="sans-serif"
          fontSize="10"
          fill="#1e40af"
          textAnchor="middle"
        >
          1 つ の 画面 で
        </text>
        <text
          x="80"
          y="76"
          fontFamily="sans-serif"
          fontSize="10"
          fill="#1e40af"
          textAnchor="middle"
        >
          全 業務 を 管理
        </text>
      </g>
      <defs>
        <marker id="arrowR" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
          <path d="M0,0 L9,3 L0,6 Z" fill="#94a3b8" />
        </marker>
      </defs>
      <line
        x1="225"
        y1="160"
        x2="365"
        y2="160"
        stroke="#94a3b8"
        strokeWidth="2"
        markerEnd="url(#arrowR)"
      />
      <line
        x1="535"
        y1="160"
        x2="675"
        y2="160"
        stroke="#94a3b8"
        strokeWidth="2"
        markerEnd="url(#arrowR)"
      />
      <text
        x="295"
        y="148"
        fontFamily="sans-serif"
        fontSize="10"
        fill="#64748b"
        textAnchor="middle"
      >
        メッセージ / 応募
      </text>
      <text
        x="605"
        y="148"
        fontFamily="sans-serif"
        fontSize="10"
        fill="#64748b"
        textAnchor="middle"
      >
        自動 通知 / AI 補助
      </text>
    </svg>
  );
}
