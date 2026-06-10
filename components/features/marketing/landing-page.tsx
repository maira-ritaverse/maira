import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  Briefcase,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { ContactForm } from "@/components/features/marketing/contact-form";

/**
 * エージェント向けランディングページ。
 *
 * 世界観方針:「落ち着いた知性 / 静かな藤色」
 * - 配色は深い藍を基調にし、AI のアクセントとして藤色(fujiiro)を一点だけ差す。
 *   蛍光や強い差し色は避け、和文に馴染む彩度に抑える。
 * - 和欧三書体(Fraunces / Noto Serif JP / Noto Sans JP)で
 *   編集的な版面を作る。フォントは (marketing)/layout.tsx で供給。
 * - 余白をゆったり取り、各セクションを節として呼吸させる。
 * - シグネチャー = ヒーロー右の「つながりグラフィック」。
 *   候補者とエージェントが弧で結ばれる様子を、控えめなパルスで表現。
 *   prefers-reduced-motion ではアニメを停止する。
 *
 * 全セクションはこのファイル内の関数コンポーネントに分割している。
 * フォーム送信は client component の ContactForm 側で扱う(送信処理は別タスク)。
 */
export function LandingPage() {
  return (
    <div className="lp-surface min-h-screen font-[family-name:var(--font-lp-ja-body)] text-[color:var(--lp-ink)] antialiased">
      <LandingStyles />
      <Header />
      <main>
        <Hero />
        <Challenge />
        <Solution />
        <Features />
        <Trust />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 全体スタイル(ローカル CSS)                                       */
/* ------------------------------------------------------------------ */

/**
 * LP 全体に効かせるごく薄い背景テクスチャと、和文の組版補正、
 * シグネチャー用のキーフレーム。Tailwind の任意値で書くと
 * 視認性が落ちるので、ここだけ素の CSS で記述する。
 */
function LandingStyles() {
  return (
    <style>{`
      .lp-surface {
        background-color: var(--lp-bg);
        background-image:
          radial-gradient(1100px 540px at 12% -10%, oklch(0.96 0.025 290 / 0.55), transparent 60%),
          radial-gradient(900px 480px at 105% 8%, oklch(0.95 0.018 95 / 0.6), transparent 60%);
        background-attachment: fixed;
      }
      .lp-surface :where(h1, h2, h3) {
        font-feature-settings: "palt" 1;
        letter-spacing: 0.02em;
      }
      .lp-surface :where(p) {
        line-height: 1.95;
        letter-spacing: 0.03em;
      }
      .lp-eyebrow {
        font-family: var(--font-lp-display), serif;
        font-weight: 400;
        letter-spacing: 0.32em;
        text-transform: uppercase;
        color: var(--lp-fuji);
        font-size: 0.72rem;
      }
      .lp-serif-ja {
        font-family: var(--font-lp-ja-display), "Noto Serif JP", serif;
        font-feature-settings: "palt" 1;
      }
      .lp-serif-en {
        font-family: var(--font-lp-display), serif;
        font-feature-settings: "ss01" 1;
      }
      .lp-rule {
        height: 1px;
        background: linear-gradient(to right, transparent, var(--lp-line-strong), transparent);
      }
      /* シグネチャー:つながりの呼吸 */
      .lp-pulse-stroke {
        stroke-dasharray: 6 8;
        animation: lp-flow 9s linear infinite;
      }
      .lp-pulse-dot {
        transform-origin: center;
        animation: lp-breath 4.6s ease-in-out infinite;
      }
      .lp-pulse-dot-late {
        animation-delay: 1.4s;
      }
      .lp-pulse-ring {
        transform-origin: center;
        animation: lp-ring 7.5s ease-in-out infinite;
      }
      @keyframes lp-flow {
        to { stroke-dashoffset: -56; }
      }
      @keyframes lp-breath {
        0%, 100% { transform: scale(1); opacity: 0.85; }
        50%      { transform: scale(1.15); opacity: 1; }
      }
      @keyframes lp-ring {
        0%, 100% { transform: scale(1); opacity: 0.55; }
        50%      { transform: scale(1.04); opacity: 0.8; }
      }
      @media (prefers-reduced-motion: reduce) {
        .lp-pulse-stroke,
        .lp-pulse-dot,
        .lp-pulse-ring {
          animation: none !important;
        }
      }
    `}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--lp-line)] bg-[color:var(--lp-bg)]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:h-20 lg:px-10">
        <Link
          href="/"
          className="lp-serif-en text-[color:var(--lp-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)]"
        >
          <span className="text-2xl font-medium tracking-[-0.01em] sm:text-[1.7rem]">Maira</span>
          <span className="ml-2 align-middle text-[0.65rem] tracking-[0.3em] text-[color:var(--lp-ink-faint)] uppercase">
            for agencies
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-6">
          <Link
            href="/login"
            className="hidden text-sm text-[color:var(--lp-ink-soft)] underline-offset-4 transition-colors hover:text-[color:var(--lp-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)] sm:inline"
          >
            ログイン
          </Link>
          <a
            href="#contact"
            className="group inline-flex items-center gap-2 rounded-full bg-[color:var(--lp-navy)] px-5 py-2.5 text-sm text-white transition-all hover:bg-[color:var(--lp-navy-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--lp-fuji)] sm:px-6"
          >
            お問い合わせ
            <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </nav>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl gap-16 px-6 pt-20 pb-28 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-10 lg:pt-32 lg:pb-40">
        <div className="relative z-10 flex flex-col justify-center">
          <p className="lp-eyebrow">AI Native Recruitment CRM</p>
          <h1 className="lp-serif-ja mt-7 text-[2.4rem] leading-[1.35] font-medium text-[color:var(--lp-ink)] sm:text-[3rem] sm:leading-[1.32] lg:text-[3.5rem]">
            <span className="block">候補者と</span>
            <span className="block">
              <span className="relative inline-block">
                つながる
                <span
                  aria-hidden
                  className="absolute right-0 -bottom-1 left-0 h-[6px] bg-[color:var(--lp-fuji-soft)]/40"
                />
              </span>
              、AIネイティブな
            </span>
            <span className="block">採用CRM。</span>
          </h1>
          <p className="mt-10 max-w-lg text-[0.97rem] text-[color:var(--lp-ink-soft)]">
            候補者の状況をAIが要約し、次の一手を示す。
            <br />
            求職者の動きは、リアルタイムで届く。
            <br />
            中小転職エージェントのための、新しい採用管理。
          </p>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <a
              href="#contact"
              className="group inline-flex items-center gap-3 rounded-full bg-[color:var(--lp-navy)] px-7 py-3.5 text-[0.95rem] text-white transition-all hover:bg-[color:var(--lp-navy-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--lp-fuji)]"
            >
              お問い合わせ
              <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 px-2 py-3 text-[0.95rem] text-[color:var(--lp-ink)] transition-colors hover:text-[color:var(--lp-fuji)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)]"
            >
              <span className="border-b border-[color:var(--lp-line-strong)] pb-0.5 transition-colors group-hover:border-[color:var(--lp-fuji)]">
                ログインはこちら
              </span>
            </Link>
          </div>
        </div>
        <div className="relative flex items-center justify-center">
          <ConnectionSignature />
        </div>
      </div>
      <div className="lp-rule mx-auto max-w-6xl px-6 lg:px-10" aria-hidden />
    </section>
  );
}

/**
 * ヒーロー右に置くシグネチャーグラフィック。
 *
 * - 左の三点(候補者)と右の二点(エージェント)を、
 *   中央の弧と中継ノードで繋ぐ静かな図。
 * - 弧は破線を流すことで「情報が流れている」ことを暗示。
 *   prefers-reduced-motion 環境では静止する(LandingStyles 参照)。
 */
function ConnectionSignature() {
  return (
    <svg
      viewBox="0 0 420 420"
      role="img"
      aria-label="候補者とエージェントが線でつながる様子"
      className="h-auto w-full max-w-[460px]"
    >
      <defs>
        <radialGradient id="lp-soft-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.62 0.16 290)" stopOpacity="0.16" />
          <stop offset="70%" stopColor="oklch(0.62 0.16 290)" stopOpacity="0.02" />
          <stop offset="100%" stopColor="oklch(0.62 0.16 290)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lp-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="oklch(0.55 0.13 290)" stopOpacity="0.05" />
          <stop offset="50%" stopColor="oklch(0.55 0.13 290)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="oklch(0.205 0.045 265)" stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* やわらかな後光 */}
      <circle cx="210" cy="210" r="200" fill="url(#lp-soft-glow)" />

      {/* 外周の細い円(呼吸) */}
      <circle
        cx="210"
        cy="210"
        r="168"
        fill="none"
        stroke="oklch(0.74 0.018 260)"
        strokeOpacity="0.45"
        strokeWidth="1"
        className="lp-pulse-ring"
      />
      <circle
        cx="210"
        cy="210"
        r="120"
        fill="none"
        stroke="oklch(0.74 0.018 260)"
        strokeOpacity="0.3"
        strokeWidth="1"
        strokeDasharray="2 6"
      />

      {/* 候補者側(左の三点) */}
      <g>
        <line
          x1="60"
          y1="160"
          x2="210"
          y2="210"
          stroke="oklch(0.74 0.018 260)"
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <line
          x1="42"
          y1="232"
          x2="210"
          y2="210"
          stroke="oklch(0.74 0.018 260)"
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <line
          x1="74"
          y1="298"
          x2="210"
          y2="210"
          stroke="oklch(0.74 0.018 260)"
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <circle cx="60" cy="160" r="4.5" fill="oklch(0.205 0.045 265)" className="lp-pulse-dot" />
        <circle
          cx="42"
          cy="232"
          r="6"
          fill="oklch(0.205 0.045 265)"
          className="lp-pulse-dot lp-pulse-dot-late"
        />
        <circle
          cx="74"
          cy="298"
          r="3.5"
          fill="oklch(0.205 0.045 265)"
          className="lp-pulse-dot"
          style={{ animationDelay: "2.6s" }}
        />
        <text
          x="22"
          y="350"
          fontFamily="var(--font-lp-display), serif"
          fontSize="10"
          letterSpacing="0.28em"
          fill="oklch(0.55 0.02 258)"
        >
          CANDIDATE
        </text>
      </g>

      {/* エージェント側(右の二点) */}
      <g>
        <line
          x1="358"
          y1="172"
          x2="210"
          y2="210"
          stroke="oklch(0.74 0.018 260)"
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <line
          x1="376"
          y1="272"
          x2="210"
          y2="210"
          stroke="oklch(0.74 0.018 260)"
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <circle
          cx="358"
          cy="172"
          r="5.5"
          fill="oklch(0.205 0.045 265)"
          className="lp-pulse-dot"
          style={{ animationDelay: "0.8s" }}
        />
        <circle
          cx="376"
          cy="272"
          r="4"
          fill="oklch(0.205 0.045 265)"
          className="lp-pulse-dot lp-pulse-dot-late"
        />
        <text
          x="296"
          y="350"
          fontFamily="var(--font-lp-display), serif"
          fontSize="10"
          letterSpacing="0.28em"
          fill="oklch(0.55 0.02 258)"
        >
          AGENCY
        </text>
      </g>

      {/* 中央の弧(流れる情報) */}
      <path
        d="M 78 232 Q 210 60 372 192"
        fill="none"
        stroke="url(#lp-arc)"
        strokeWidth="1.4"
        strokeLinecap="round"
        className="lp-pulse-stroke"
      />
      <path
        d="M 82 268 Q 210 372 372 252"
        fill="none"
        stroke="url(#lp-arc)"
        strokeWidth="1.4"
        strokeLinecap="round"
        className="lp-pulse-stroke"
        style={{ animationDelay: "-3s" }}
      />

      {/* 中央のハブ(Maira) */}
      <circle
        cx="210"
        cy="210"
        r="22"
        fill="oklch(0.985 0.005 90)"
        stroke="oklch(0.205 0.045 265)"
        strokeWidth="1.2"
      />
      <circle
        cx="210"
        cy="210"
        r="8"
        fill="oklch(0.55 0.13 290)"
        className="lp-pulse-dot"
        style={{ animationDelay: "0.3s" }}
      />
      <text
        x="210"
        y="252"
        textAnchor="middle"
        fontFamily="var(--font-lp-display), serif"
        fontSize="11"
        letterSpacing="0.32em"
        fill="oklch(0.36 0.028 262)"
      >
        MAIRA
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Challenge                                                           */
/* ------------------------------------------------------------------ */

function Challenge() {
  return (
    <section className="relative">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-28 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20 lg:px-10 lg:py-40">
        <div className="flex flex-col">
          <p className="lp-eyebrow">01 — 現在地</p>
          <h2 className="lp-serif-ja mt-8 text-[1.9rem] leading-[1.6] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
            その候補者、
            <br />
            最後にどうなりましたか?
          </h2>
        </div>
        <div className="max-w-xl space-y-7 text-[0.97rem] text-[color:var(--lp-ink-soft)]">
          <p>
            表計算に散らばる連絡履歴。打ち合わせの合間に、誰がどこまで進んでいたかを思い出すことから一日が始まる。情報を整える時間に、対話の時間が削られていく。
          </p>
          <p>
            候補者の小さな変化──職務経歴の更新、希望条件のゆらぎ、別エージェントへの相談──にはなかなか気づけない。気づいた時には、もう次の選考に進んでいたりする。
          </p>
          <p>
            管理は、増やすほど薄くなる。
            <br />
            本当に向き合うべき相手と、向き合う時間をつくり直したい。
          </p>
        </div>
      </div>
      <div className="lp-rule mx-auto max-w-6xl px-6 lg:px-10" aria-hidden />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Solution(3カード)                                                 */
/* ------------------------------------------------------------------ */

type SolutionCard = {
  number: string;
  title: string;
  body: string;
};

const SOLUTION_CARDS: SolutionCard[] = [
  {
    number: "01",
    title: "AIが状況を要約する",
    body: "対応履歴、紹介中の求人、未着手のタスク。それらをAIが数秒で読み解き、いま何が起きていて、次にどんな一手が良いかまで示します。資料を開き直すたびに、頭の中を組み立て直す必要はもうありません。",
  },
  {
    number: "02",
    title: "求職者の動きが、自動で届く",
    body: "候補者がMaira上で職務経歴を更新したり、希望を見直したとき、エージェントの画面には静かに「更新あり」が灯ります。聞きに行かなくても、最新の候補者像が、いつもそこにある。",
  },
  {
    number: "03",
    title: "預かる情報を、構造から守る",
    body: "内面情報や悩みは、構造的にエージェントへは開示されません。候補者本人の同意があった範囲だけが届く設計。暗号化基盤の上で、信頼を仕組みとして担保します。",
  },
];

function Solution() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-28 lg:px-10 lg:py-40">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <p className="lp-eyebrow">02 — 解決の輪郭</p>
            <h2 className="lp-serif-ja mt-8 text-[1.9rem] leading-[1.6] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
              Mairaが、
              <br />
              その時間を返す。
            </h2>
          </div>
          <p className="max-w-xl self-end text-[0.97rem] text-[color:var(--lp-ink-soft)]">
            管理に追われる代わりに、候補者と向き合うための余白を取り戻す。
            AIネイティブに作り直された採用CRMが、エージェントの実務に静かに寄り添います。
          </p>
        </div>
        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-[color:var(--lp-line)] bg-[color:var(--lp-line)] md:grid-cols-3">
          {SOLUTION_CARDS.map((card) => (
            <article
              key={card.number}
              className="group relative flex flex-col gap-6 bg-[color:var(--lp-bg)] p-9 transition-colors hover:bg-[color:var(--lp-bg-tint)] sm:p-11"
            >
              <div className="flex items-center justify-between">
                <span className="lp-serif-en text-[1.6rem] text-[color:var(--lp-fuji)]">
                  {card.number}
                </span>
                <span
                  aria-hidden
                  className="h-px w-12 bg-[color:var(--lp-line-strong)] transition-all group-hover:w-20 group-hover:bg-[color:var(--lp-fuji)]"
                />
              </div>
              <h3 className="lp-serif-ja text-[1.2rem] font-medium text-[color:var(--lp-ink)] sm:text-[1.3rem]">
                {card.title}
              </h3>
              <p className="text-[0.93rem] text-[color:var(--lp-ink-soft)]">{card.body}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="lp-rule mx-auto max-w-6xl px-6 lg:px-10" aria-hidden />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Features(4項目)                                                   */
/* ------------------------------------------------------------------ */

type FeatureItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  body: string;
};

const FEATURES: FeatureItem[] = [
  {
    icon: LayoutGrid,
    label: "Clients",
    title: "Excel風クライアント管理",
    body: "見慣れたグリッドで、候補者と求人を一覧できる。フィルタ、並べ替え、一括編集──業務の手触りを残したまま、AIで強化しました。",
  },
  {
    icon: Briefcase,
    label: "Matching",
    title: "求人マッチング・紹介管理",
    body: "希望と職歴を照らし合わせ、紹介すべき求人と理由を提示。紹介から面接、内定まで、ひとつのタイムラインで追えます。",
  },
  {
    icon: Sparkles,
    label: "Insights",
    title: "AI状況サマリー",
    body: "クライアントを開いた瞬間、AIが最新の状況を数行で要約。今日連絡すべき相手と、その理由が、画面の上から並びます。",
  },
  {
    icon: BarChart3,
    label: "Reports",
    title: "成約・売上レポート",
    body: "紹介数、面接率、成約金額。KPIを月次・四半期で可視化し、チームの動きを定量で把握できます。",
  },
];

function Features() {
  return (
    <section className="relative bg-[color:var(--lp-bg-tint)]">
      <div className="mx-auto max-w-6xl px-6 py-28 lg:px-10 lg:py-40">
        <div className="flex flex-col items-start gap-6">
          <p className="lp-eyebrow">03 — 機能</p>
          <h2 className="lp-serif-ja max-w-2xl text-[1.9rem] leading-[1.5] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
            日々の業務に、
            <br className="sm:hidden" />
            ちょうどいい。
          </h2>
        </div>
        <div className="mt-20 grid gap-x-12 gap-y-16 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, label, title, body }) => (
            <article key={title} className="flex flex-col">
              <div className="flex items-center gap-4">
                <div className="flex size-11 items-center justify-center rounded-full border border-[color:var(--lp-line-strong)] bg-[color:var(--lp-bg)] text-[color:var(--lp-fuji)]">
                  <Icon className="size-5" />
                </div>
                <span className="lp-serif-en text-[0.7rem] tracking-[0.32em] text-[color:var(--lp-ink-faint)] uppercase">
                  {label}
                </span>
              </div>
              <h3 className="lp-serif-ja mt-7 text-[1.2rem] font-medium text-[color:var(--lp-ink)] sm:text-[1.3rem]">
                {title}
              </h3>
              <p className="mt-4 max-w-md text-[0.93rem] text-[color:var(--lp-ink-soft)]">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trust(信頼・安心)                                                 */
/* ------------------------------------------------------------------ */

function Trust() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-3xl px-6 py-28 text-center lg:py-40">
        <div className="mx-auto inline-flex items-center gap-3 rounded-full border border-[color:var(--lp-line-strong)] bg-[color:var(--lp-bg)] px-5 py-2 text-[color:var(--lp-fuji)]">
          <ShieldCheck className="size-4" />
          <span className="lp-serif-en text-[0.65rem] tracking-[0.3em] uppercase">
            Structural Trust
          </span>
        </div>
        <h2 className="lp-serif-ja mt-10 text-[1.9rem] leading-[1.55] font-medium text-[color:var(--lp-ink)] sm:text-[2.4rem]">
          候補者の信頼が、
          <br />
          エージェントの信頼に。
        </h2>
        <div className="mt-12 space-y-7 text-left text-[0.97rem] text-[color:var(--lp-ink-soft)] sm:text-center">
          <p>
            Mairaは、候補者本人が自分のデータを持つ前提で設計されています。
            エージェントに届くのは、本人が同意した範囲の情報だけ。内面や悩みは、構造的にエージェントの画面には表示されません。
          </p>
          <p>
            「ここなら安心して話せる」と候補者が思える環境は、紹介の質を上げ、面談の歩留まりを上げ、最終的にエージェントの信頼として返ってきます。
            <br />
            安全な仕組みは、ビジネスの土台です。
          </p>
        </div>
      </div>
      <div className="lp-rule mx-auto max-w-6xl px-6 lg:px-10" aria-hidden />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Contact                                                             */
/* ------------------------------------------------------------------ */

function Contact() {
  return (
    <section id="contact" className="relative scroll-mt-24">
      <div className="mx-auto grid max-w-6xl gap-16 px-6 py-28 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20 lg:px-10 lg:py-40">
        <div className="flex flex-col">
          <p className="lp-eyebrow">04 — お問い合わせ</p>
          <h2 className="lp-serif-ja mt-8 text-[1.9rem] leading-[1.5] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
            まずは、
            <br />
            お話を聞かせてください。
          </h2>
          <p className="mt-8 max-w-md text-[0.97rem] text-[color:var(--lp-ink-soft)]">
            導入のご相談、デモのご希望、料金のお見積もり。
            まずはお気軽にお問い合わせください。担当よりご連絡差し上げます。
          </p>
          <div className="mt-12 hidden flex-col gap-3 text-[0.85rem] text-[color:var(--lp-ink-faint)] lg:flex">
            <div className="flex items-center gap-3">
              <span className="lp-serif-en tracking-[0.3em] uppercase">From</span>
              <span className="h-px flex-1 bg-[color:var(--lp-line)]" />
              <span>株式会社リタバース</span>
            </div>
          </div>
        </div>
        <ContactForm />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="bg-[color:var(--lp-navy-deep)] text-white/80">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-20 lg:px-10 lg:py-20">
        <div>
          <Link
            href="/"
            className="lp-serif-en text-[1.75rem] font-medium tracking-[-0.01em] text-white"
          >
            Maira
          </Link>
          <p className="mt-6 text-[0.85rem] leading-relaxed text-white/65">
            候補者とつながる、AIネイティブな採用CRM。
            <br />
            中小転職エージェントのための採用管理。
          </p>
          <p className="mt-8 text-[0.75rem] text-white/55">
            株式会社リタバース
            <span className="lp-serif-en ml-2 tracking-[0.25em]">RITAVERSE</span>
          </p>
        </div>
        <div>
          <p className="lp-serif-en text-[0.65rem] tracking-[0.3em] text-white/55 uppercase">
            Product
          </p>
          <ul className="mt-5 space-y-3 text-[0.88rem]">
            <li>
              <Link
                href="/login"
                className="transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji-soft)]"
              >
                ログイン
              </Link>
            </li>
            <li>
              <a
                href="#contact"
                className="transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji-soft)]"
              >
                お問い合わせ
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="lp-serif-en text-[0.65rem] tracking-[0.3em] text-white/55 uppercase">
            Legal
          </p>
          <ul className="mt-5 space-y-3 text-[0.88rem]">
            <li>
              {/* 規約類は未整備のため、リンク枠だけ用意。整備時に href を差し替える */}
              <a
                href="#"
                aria-disabled="true"
                className="text-white/55 transition-colors hover:text-white"
              >
                利用規約
              </a>
            </li>
            <li>
              <a
                href="#"
                aria-disabled="true"
                className="text-white/55 transition-colors hover:text-white"
              >
                プライバシーポリシー
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 py-6 text-[0.75rem] text-white/55 sm:flex-row sm:items-center lg:px-10">
          <p>© 2026 RITAVERSE Inc. All rights reserved.</p>
          <p className="lp-serif-en tracking-[0.25em] uppercase">Made in Tokyo</p>
        </div>
      </div>
    </footer>
  );
}
