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
  ArrowRight,
  Bell,
  Briefcase,
  Calendar,
  CheckCircle2,
  FileText,
  Lock,
  type LucideIcon,
  MessageSquare,
  Shield,
  Smartphone,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { BrandMark } from "./brand-mark";
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
        <FeatureLineMa />
        <FeatureCalendar />
        <FeatureAiDocument />
        <FeatureDigest />
        <FeatureReport />
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
          <BrandMark className="text-lg font-bold tracking-tight" />
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
            資料請求
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
            転職エージェント業務効率化SaaS
          </div>
          <h1 className="text-4xl leading-[1.2] font-bold tracking-tight sm:text-5xl">
            エージェント業務を、
            <br />
            <span className="text-emerald-600">AIで1人3倍速に。</span>
          </h1>
          <p className="text-base leading-relaxed text-slate-600 sm:text-lg">
            クライアント管理・公式LINE連携・カレンダー同期・推薦文AI下書き・進捗管理まで、日々の業務を1つの画面で完結。取りこぼしは朝のダイジェストで防ぎます。
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="#cta"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-600"
            >
              <FileText className="size-4" aria-hidden />
              資料を請求する(無料)
            </a>
            <a
              href="#features"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              機能を見る →
            </a>
            <Link
              href="/roi"
              className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-5 py-3 text-sm font-semibold text-orange-700 hover:bg-orange-100"
            >
              <Sparkles className="size-4" aria-hidden />
              導入効果を試算する
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-2 pt-2 text-xs text-slate-600">
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              テスト導入1ヶ月無料
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              初期セットアップ30分
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              データ移行サポート
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
              解約時データエクスポート
            </li>
          </ul>
        </div>
        <ScreenshotFrame
          caption="ダッシュボード:今日期限のタスクと沈黙顧客を一目で"
          src="/marketing/dashboard.png"
          alt="Maira ダッシュボード"
        >
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
      title: "対応忘れで機会損失",
      body: "顧客が100人を超えると、連絡漏れが月数件発生する",
    },
    {
      icon: FileText,
      title: "書類作成が時間を奪う",
      body: "履歴書・推薦文を1件30分かけて手書きしている",
    },
    {
      icon: MessageSquare,
      title: "LINEの個別対応が限界",
      body: "属人化して、担当不在時に返信が止まる",
    },
    {
      icon: Workflow,
      title: "進捗管理が表計算任せ",
      body: "Excelが増殖し、誰が何をやったか分からない",
    },
  ];
  return (
    <section className="border-y border-slate-100 bg-slate-50/50 py-20">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <p className="text-center text-xs font-semibold tracking-[0.2em] text-emerald-600 uppercase">
          こんなお困りごと、ありませんか
        </p>
        <h2 className="mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">
          エージェント業務の「あるある」をAIで解消
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
            Mairaの全体像
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            求職者とエージェントを、1つのハブでつなぐ
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600">
            求職者からのLINE/Web経由のアクションをエージェント業務とシームレスに連携。各ハブがAIで連動します。
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
  screenshotSrc,
  screenshotAlt,
}: {
  id?: string;
  badge: string;
  title: string;
  description: string;
  bullets: string[];
  mock: React.ReactNode;
  reverse?: boolean;
  /** 実 スクショ が ある なら 指定。 無ければ mock (SVG) が fallback */
  screenshotSrc?: string;
  screenshotAlt?: string;
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
        <ScreenshotFrame src={screenshotSrc} alt={screenshotAlt}>
          {mock}
        </ScreenshotFrame>
      </div>
    </section>
  );
}

function FeatureCrm() {
  return (
    <div id="features">
      <FeatureSection
        badge="クライアント管理"
        title="求職者を「忘れない」CRM"
        description="紹介状況・沈黙期間・重複を自動検出。タスクと期限で「次にやること」が一目でわかります。"
        bullets={[
          "30/60/90日沈黙の顧客を自動ハイライト",
          "電話・メール・同名で重複候補を自動検出",
          "未入力項目をフィールド別に可視化",
          "カンバン/一覧/カードをワンクリックで切替",
        ]}
        mock={<CrmMock />}
      />
    </div>
  );
}

function FeatureLine() {
  return (
    <FeatureSection
      badge="公式LINE連携"
      title="LINEで100名を一人でさばく"
      description="公式LINEとMairaを直接接続。トーク・担当者割り当て・一斉配信・シナリオ自動化までMaira内で完結します。"
      bullets={[
        "1友達単位でメモ・タグ・担当者割当+編集履歴",
        "会話上で面談候補日提案 → タップで会議URL発行まで一気通貫",
        "送信タイミングを候補別に確認/利用履歴を右サイドバーに集約",
        "短縮URLでクリック・応募を計測",
      ]}
      mock={<LineConversationMock />}
      screenshotSrc="/marketing/line-conversation.png"
      screenshotAlt="Maira LINE会話画面"
      reverse
    />
  );
}

function FeatureLineMa() {
  return (
    <FeatureSection
      badge="LINE MA(β)"
      title="休眠求職者を自動で掘り起こす"
      description="「友達追加後ウェルカム」「面談前リマインド」「休眠求職者の掘り起こし」など、求職者ライフサイクルに合わせた自動配信シナリオをプリセットで提供します。"
      bullets={[
        "全友達/連携済/未連携/タグ別に一斉配信",
        "7件のシナリオプリセットをON/OFFで即運用開始",
        "配信数・クリック・返信・応募を月次KPIで可視化",
        "テキスト/求人カードの2種類、即時+予約配信に対応",
      ]}
      mock={<LineConversationMock />}
      screenshotSrc="/marketing/line-ma.png"
      screenshotAlt="Maira LINE MA画面"
    />
  );
}

function FeatureCalendar() {
  return (
    <FeatureSection
      badge="カレンダー+会議連携"
      title="月ビューで面談と受付を一目把握"
      description="エージェントが候補日3件を投げるだけ。求職者がタップした瞬間に会議URLが発行され、双方のカレンダーに同期。月ビューで全メンバーの予定を一望できます。"
      bullets={[
        "Googleカレンダー/ZoomとOAuth連携で自動URL発行",
        "面談・受付・タスク・対応履歴・Google予定を1画面に",
        "面談24時間前/1時間前に自動リマインダー",
        "カレンダー購読URLで個人端末(iCal等)からも閲覧可",
      ]}
      mock={<CalendarMock />}
      screenshotSrc="/marketing/calendar.png"
      screenshotAlt="Mairaカレンダー月ビュー"
    />
  );
}

function FeatureReport() {
  return (
    <FeatureSection
      badge="レポート"
      title="ステータス分布と売上を月次で把握"
      description="求職者・紹介が今どの段階に何件あるか、純売上・入金・返金まで1画面で確認できます。月次/任意期間で切り替え可能。"
      bullets={[
        "求職者ステータス × 紹介ステータスの2軸分布",
        "純売上 = 成約 + 追加報酬 − 返金 の月次集計",
        "今月/先月/任意期間をワンクリックで切替",
        "アドバイザー別パフォーマンス(管理者のみ)",
      ]}
      mock={<DashboardMock />}
      screenshotSrc="/marketing/report.png"
      screenshotAlt="Mairaレポート画面"
      reverse
    />
  );
}

function FeatureAiDocument() {
  return (
    <FeatureSection
      badge="AI文書生成"
      title="録音を流すだけで履歴書ができる"
      description="面談録音(Zoom/手動アップロード)をWhisperで文字起こし → Claudeが構造化 → 履歴書・職務経歴書・推薦文を自動ドラフト。"
      bullets={[
        "Whisperによる高精度な文字起こし",
        "Claude Sonnet 4.6で構造化抽出",
        "PDF(Puppeteer)で厚労省推奨様式を出力",
        "編集履歴/バージョン管理で安全に推敲",
      ]}
      mock={<AiDocumentMock />}
      reverse
    />
  );
}

function FeatureDigest() {
  return (
    <FeatureSection
      badge="プロアクティブ伴走"
      title="毎朝8時、「今日やること」が1通で届く"
      description="期限切れタスク・30日沈黙顧客・進捗停止中の応募を集計して、管理者にメール配信。0件の朝は送らないので開封率を維持できます。"
      bullets={[
        "個人設定でメール全体ON/OFF + 種類別ON/OFF",
        "アプリ内通知も連動(LINE受信・興味表明・応募)",
        "「何をいつまでにやるか」をMairaが教えてくれる",
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
      title: "AES-256-GCM暗号化",
      body: "会話・キャリア・タスク・応募詳細をサーバーサイドで暗号化",
    },
    {
      icon: Shield,
      title: "RLSで完全テナント分離",
      body: "Supabase RLSで、組織を跨いだアクセスを物理的に不可能に",
    },
    {
      icon: CheckCircle2,
      title: "Webhook HMAC検証",
      body: "LINE/Stripe/Zoom等の全webhookをHMAC-SHA256で署名検証",
    },
    {
      icon: FileText,
      title: "運営アクセス範囲を明示",
      body: "プライバシーポリシーで運営の閲覧範囲を明文化",
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
            機密情報を守るための4段防御
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-300">
            求職者の個人情報と採用業務の機密性を、真剣に設計しています。
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
            まずは1ヶ月、
            <br />
            無料でお試しください
          </h2>
          <p className="text-sm leading-relaxed text-white/90 sm:text-base">
            お申し込み後、1営業日以内に担当から資料PDFとセットアップ手順をお送りします。機能制限なしのフル機能を1ヶ月ご利用いただけます。
          </p>
          <ul className="space-y-2 pt-2 text-sm">
            {[
              "全機能を1ヶ月無料で試せる",
              "初期セットアップ30分サポート",
              "CSVデータ移行サポート",
              "解約時データエクスポート保証",
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
      q: "テスト導入中のデータは、本番でそのまま使えますか?",
      a: "はい。テスト中に入力したデータは本契約後そのまま引き継がれます。解約時はCSV/JSONで一括エクスポート可能です。",
    },
    {
      q: "求職者への公開範囲はコントロールできますか?",
      a: "求職者が個別に「連携解除申請」で開示を停止でき、猶予期間経過で自動確定します。二段階解除で業務中断を防ぎます。",
    },
    {
      q: "LINE連携はどの規模まで対応できますか?",
      a: "LINE Messaging APIのLight(5,000通/月)からProまで全プランに対応。配信数の残量はMaira内で可視化されます。",
    },
    {
      q: "Google Meet/Zoom連携でカレンダーの既存予定は見えますか?",
      a: "scopeは最小限(calendar.events)で、Mairaから作成した予定のみ編集/削除します。既存予定は読み取りません。",
    },
    {
      q: "AI利用量に上限はありますか?",
      a: "月次で機能別の上限があり、アドオン契約で緩和できます。残量はダッシュボードで常時確認可能です。",
    },
    {
      q: "サポートの連絡手段は?",
      a: "メールおよびお問い合わせフォームから、1営業日以内に一次返信します。",
    },
  ];
  return (
    <section className="border-t border-slate-100 bg-white py-20">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <p className="text-center text-xs font-semibold tracking-[0.2em] text-emerald-600 uppercase">
          FAQ
        </p>
        <h2 className="mt-3 text-center text-3xl font-bold tracking-tight sm:text-4xl">
          よくあるご質問
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
            <BrandMark className="text-base font-bold" />
          </div>
          <p className="text-xs leading-relaxed text-slate-600">
            転職エージェント業務効率化SaaS
            <br />
            運営: 株式会社Revorise
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
                資料請求
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
                プライバシーポリシー
              </Link>
            </li>
            <li>
              <Link href="/terms" className="text-slate-600 hover:text-slate-900">
                利用規約
              </Link>
            </li>
            <li>
              <Link href="/legal" className="text-slate-600 hover:text-slate-900">
                特定商取引法
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

function ScreenshotFrame({
  children,
  caption,
  src,
  alt,
}: {
  children: React.ReactNode;
  caption?: string;
  /**
   * 実 スクリーン ショット の パス (例: "/marketing/dashboard.png")。
   * 指定 さ れて いれば <Image> で 表示、 未 指定 なら children (SVG モック) を fallback。
   * 画像 配置 ガイド: public/marketing/README.md 参照。
   */
  src?: string;
  alt?: string;
}) {
  return (
    <figure className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
        </div>
        <div className="aspect-video bg-white">
          {src ? (
            <Image
              src={src}
              alt={alt ?? ""}
              width={1920}
              height={1080}
              className="h-full w-full object-contain"
              priority={false}
            />
          ) : (
            children
          )}
        </div>
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
  const seekerFeatures = ["公式LINEで連絡", "面談日をタップで選択", "求人に興味あり/応募"];
  const agentFeatures = [
    "進捗を一目で把握",
    "朝のダイジェストで取りこぼし防止",
    "AIが書類作成を補助",
  ];
  const hubFeatures: { icon: LucideIcon; label: string }[] = [
    { icon: Users, label: "CRM" },
    { icon: MessageSquare, label: "LINE" },
    { icon: Calendar, label: "カレンダー" },
    { icon: FileText, label: "AI文書" },
  ];

  return (
    <div className="grid items-center gap-4 lg:grid-cols-[1fr_auto_1.4fr_auto_1fr] lg:gap-2">
      {/* 求職者 */}
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/15">
          <Smartphone className="size-6 text-emerald-700" aria-hidden />
        </div>
        <h3 className="mt-3 text-base font-bold text-emerald-900">求職者</h3>
        <p className="text-xs text-emerald-700/80">スマホ完結</p>
        <ul className="mt-3 space-y-1 text-left text-xs text-emerald-900">
          {seekerFeatures.map((f) => (
            <li key={f} className="flex items-start gap-1">
              <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" aria-hidden />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <FlowArrow label="メッセージ / 応募" />

      {/* Maira ハブ (中央) */}
      <div className="rounded-2xl bg-slate-900 p-6 text-center text-white shadow-xl">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-emerald-300 uppercase">
          all-in-one hub
        </p>
        <h3 className="mt-1 text-2xl font-bold">Maira</h3>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
          {hubFeatures.map((f) => (
            <div
              key={f.label}
              className="flex flex-col items-center gap-1 rounded-lg bg-white/5 p-2 transition-colors hover:bg-white/10"
            >
              <f.icon className="size-5 text-emerald-300" aria-hidden />
              <span className="text-[11px] font-medium">{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      <FlowArrow label="通知 / AI補助" />

      {/* エージェント */}
      <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-5 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-500/15">
          <Briefcase className="size-6 text-blue-700" aria-hidden />
        </div>
        <h3 className="mt-3 text-base font-bold text-blue-900">エージェント</h3>
        <p className="text-xs text-blue-700/80">1画面で全業務</p>
        <ul className="mt-3 space-y-1 text-left text-xs text-blue-900">
          {agentFeatures.map((f) => (
            <li key={f} className="flex items-start gap-1">
              <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-blue-600" aria-hidden />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Overview Diagram 内の 矢印 + ラベル (PC: 横、 モバイル: 縦) */
function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 lg:py-0">
      <ArrowRight className="size-6 rotate-90 text-slate-400 lg:rotate-0" aria-hidden />
      <span className="text-[10px] font-medium whitespace-nowrap text-slate-500">{label}</span>
    </div>
  );
}
