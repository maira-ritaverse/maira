import {
  ArrowUpRight,
  BarChart3,
  Briefcase,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { ContactForm } from "@/components/features/marketing/contact-form";

/**
 * エージェント向けランディングページ — 改作 (preview)。
 *
 * 世界観方針:本番LPと同じ「落ち着いた知性」を共有しつつ、別の律動で組み直す。
 * - 共通トークン (--lp-*) は (marketing)/layout.tsx から継承。配色・フォントは同根。
 * - 差別点:
 *   1. 各節の左端に「背骨(スパイン)」と漢数字インデックス(一・二・三…)。
 *   2. ヒーロー右のグラフィックは弧→「ストラタ(層)」へ。水平の層を Maira の縦軸が貫く。
 *   3. ソリューションはカード3枚ではなく、罫線で区切る「台帳」型。
 *   4. 機能は2×2グリッドではなく、表組み的な「目次(タビュラ)」型の縦リスト。
 *   5. ヘッダーCTAは丸ピル→「ヘアラインCTA」(下線+矢印)へ。
 *   6. フッターは濃紺ベタ→オフホワイト継続。文書として最後まで切れない読み心地。
 *
 * 本番LPと同階層の (marketing) ルートに置くため、layout.tsx の --lp-* と
 * 和欧三書体は自動的に効く。スタイルだけ <PreviewStyles /> で別建てにしている。
 */
export function LandingPagePreview() {
  return (
    <div className="lp-preview-surface min-h-screen font-[family-name:var(--font-lp-ja-body)] text-[color:var(--lp-ink)] antialiased">
      <PreviewStyles />
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
/* スタイル(本番LPと衝突しない別系統のクラスとして定義)              */
/* ------------------------------------------------------------------ */

/**
 * - 本番LPの LandingStyles と同名クラスを再定義しない方針。
 *   ContactForm が依存している lp-serif-ja / lp-serif-en の2つだけ共有再定義する
 *   (これらは純粋なタイポクラスなので、本番と同じ定義で問題なし)。
 * - その他はすべて lp-pv-* プレフィックスで分離し、両LPが同居しても影響しない。
 */
function PreviewStyles() {
  return (
    <style>{`
      .lp-serif-ja {
        font-family: var(--font-lp-ja-display), "Noto Serif JP", serif;
        font-feature-settings: "palt" 1;
      }
      .lp-serif-en {
        font-family: var(--font-lp-display), serif;
        font-feature-settings: "ss01" 1;
      }
      .lp-preview-surface {
        background-color: var(--lp-bg);
        background-image:
          /* 上部に薄い水平の層(編集罫)を重ねる。スクロールしても固定。 */
          linear-gradient(to bottom, oklch(0.92 0.012 260 / 0.18) 1px, transparent 1px),
          radial-gradient(820px 420px at 88% -4%, oklch(0.94 0.02 290 / 0.55), transparent 60%),
          radial-gradient(720px 420px at -6% 18%, oklch(0.95 0.012 95 / 0.6), transparent 60%);
        background-size: 100% 96px, auto, auto;
        background-attachment: fixed;
      }
      .lp-preview-surface :where(h1, h2, h3) {
        font-feature-settings: "palt" 1;
        letter-spacing: 0.02em;
      }
      .lp-preview-surface :where(p) {
        line-height: 2;
        letter-spacing: 0.035em;
      }

      /* 編集的なマストヘッド(版面の上端に置く小さな見出し) */
      .lp-pv-masthead {
        font-family: var(--font-lp-display), serif;
        font-style: italic;
        font-size: 0.72rem;
        letter-spacing: 0.22em;
        color: var(--lp-ink-faint);
        text-transform: uppercase;
      }

      /* ヘアライン編集リンク。ヘッダーCTA等で使う(本番のピルとは別系統)。 */
      .lp-pv-link {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding-bottom: 4px;
        font-size: 0.92rem;
        color: var(--lp-ink);
        border-bottom: 1px solid var(--lp-line-strong);
        transition: color 200ms ease, border-color 200ms ease;
      }
      .lp-pv-link:hover {
        color: var(--lp-fuji);
        border-color: var(--lp-fuji);
      }
      .lp-pv-link:focus-visible {
        outline: 2px solid var(--lp-fuji);
        outline-offset: 6px;
        border-radius: 2px;
      }

      /* 主要CTA(ヒーロー)。本番ピルとは別の、四角形のヘアラインボタン。 */
      .lp-pv-cta {
        display: inline-flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.95rem 1.6rem 0.95rem 1.7rem;
        font-size: 0.95rem;
        color: var(--lp-bg);
        background: var(--lp-navy);
        border: 1px solid var(--lp-navy);
        transition: background 220ms ease, transform 220ms ease;
      }
      .lp-pv-cta:hover {
        background: var(--lp-navy-deep);
        transform: translateY(-1px);
      }
      .lp-pv-cta:focus-visible {
        outline: 2px solid var(--lp-fuji);
        outline-offset: 3px;
      }
      .lp-pv-cta-ghost {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.95rem 0.25rem;
        font-size: 0.95rem;
        color: var(--lp-ink);
        border-bottom: 1px solid var(--lp-line-strong);
        transition: color 200ms ease, border-color 200ms ease;
      }
      .lp-pv-cta-ghost:hover {
        color: var(--lp-fuji);
        border-color: var(--lp-fuji);
      }
      .lp-pv-cta-ghost:focus-visible {
        outline: 2px solid var(--lp-fuji);
        outline-offset: 4px;
      }

      /* 節ごとの背骨(スパイン)。漢数字インデックス + 細い縦罫。 */
      .lp-pv-spine-kanji {
        font-family: var(--font-lp-ja-display), "Noto Serif JP", serif;
        font-weight: 400;
        font-size: 1.05rem;
        color: var(--lp-fuji);
        letter-spacing: 0;
      }
      .lp-pv-spine-rule {
        width: 1px;
        background: linear-gradient(to bottom, var(--lp-line-strong), transparent 90%);
      }

      /* ストラタ罫(節の区切りに使う水平罫) */
      .lp-pv-strata-rule {
        height: 1px;
        background: linear-gradient(
          to right,
          transparent 0%,
          var(--lp-line-strong) 12%,
          var(--lp-line-strong) 88%,
          transparent 100%
        );
      }

      /* 機能リストのタブ枠 */
      .lp-pv-tab {
        font-family: var(--font-lp-display), serif;
        font-size: 0.7rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
        color: var(--lp-ink-faint);
      }

      /* 信頼セクションの「証書」枠線。二重の細罫で囲む。 */
      .lp-pv-frame {
        position: relative;
        border: 1px solid var(--lp-line-strong);
        padding: 4rem 2rem;
      }
      .lp-pv-frame::before {
        content: "";
        position: absolute;
        inset: 6px;
        border: 1px solid var(--lp-line);
        pointer-events: none;
      }
      @media (min-width: 640px) {
        .lp-pv-frame {
          padding: 5rem 4rem;
        }
      }

      /* シグネチャー:ストラタの呼吸。各層のドットがゆっくり明滅する。 */
      .lp-pv-strata-dot {
        transform-origin: center;
        animation: lp-pv-breath 5.4s ease-in-out infinite;
      }
      .lp-pv-strata-core {
        transform-origin: center;
        animation: lp-pv-core 6.8s ease-in-out infinite;
      }
      .lp-pv-axis {
        stroke-dasharray: 1 7;
        animation: lp-pv-flow 14s linear infinite;
      }
      @keyframes lp-pv-breath {
        0%, 100% { transform: scale(1); opacity: 0.55; }
        50%      { transform: scale(1.18); opacity: 0.95; }
      }
      @keyframes lp-pv-core {
        0%, 100% { transform: scale(1); opacity: 0.85; }
        50%      { transform: scale(1.08); opacity: 1; }
      }
      @keyframes lp-pv-flow {
        to { stroke-dashoffset: -56; }
      }

      /* ヒーローのフェードアップ(初回表示時のみ) */
      .lp-pv-rise {
        animation: lp-pv-rise 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
      }
      .lp-pv-rise-1 { animation-delay: 80ms; }
      .lp-pv-rise-2 { animation-delay: 220ms; }
      .lp-pv-rise-3 { animation-delay: 360ms; }
      .lp-pv-rise-4 { animation-delay: 500ms; }
      @keyframes lp-pv-rise {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      @media (prefers-reduced-motion: reduce) {
        .lp-pv-strata-dot,
        .lp-pv-strata-core,
        .lp-pv-axis,
        .lp-pv-rise {
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
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6 sm:h-20 lg:px-8">
        <Link
          href="/"
          className="flex items-baseline gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)]"
        >
          <span className="lp-serif-en text-[1.55rem] font-medium tracking-[-0.01em] text-[color:var(--lp-ink)] sm:text-[1.7rem]">
            Maira
          </span>
          <span className="lp-serif-en hidden text-[0.72rem] tracking-[0.22em] text-[color:var(--lp-ink-faint)] italic sm:inline">
            — for agencies
          </span>
        </Link>
        <nav className="flex items-center gap-6 sm:gap-9">
          <Link
            href="/login"
            className="lp-serif-en hidden text-[0.72rem] tracking-[0.28em] text-[color:var(--lp-ink-soft)] uppercase transition-colors hover:text-[color:var(--lp-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)] sm:inline"
          >
            login
          </Link>
          <a href="#contact" className="lp-pv-link">
            お問い合わせ
            <ArrowUpRight className="size-3.5" />
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
      {/* マストヘッド:版面の上端。LP全体を「号」として位置付ける小さなラベル。 */}
      <div className="mx-auto max-w-5xl px-6 pt-10 lg:px-8 lg:pt-14">
        <div className="lp-pv-rise lp-pv-rise-1 flex flex-wrap items-center gap-4 text-[color:var(--lp-ink-faint)]">
          <span className="lp-pv-masthead">Maira</span>
          <span aria-hidden className="h-px w-6 bg-[color:var(--lp-line-strong)]" />
          <span className="lp-pv-masthead">Recruitment CRM</span>
          <span aria-hidden className="h-px w-6 bg-[color:var(--lp-line-strong)]" />
          <span className="lp-pv-masthead">Edition for Agencies</span>
          <span aria-hidden className="h-px w-6 bg-[color:var(--lp-line-strong)]" />
          <span className="lp-pv-masthead">二〇二六</span>
        </div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-14 px-6 pt-12 pb-24 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:px-8 lg:pt-20 lg:pb-36">
        <div className="relative z-10 flex flex-col justify-center">
          <div className="lp-pv-rise lp-pv-rise-2 flex items-center gap-4">
            <span className="lp-pv-spine-kanji">一</span>
            <span aria-hidden className="h-px w-12 bg-[color:var(--lp-fuji-soft)]" />
            <span className="lp-serif-en text-[0.7rem] tracking-[0.32em] text-[color:var(--lp-ink-faint)] uppercase">
              Opening
            </span>
          </div>
          {/*
            和文の改行ルール:
            - 「候補者と、つながる。」/「AIネイティブな、採用CRM。」の二段組。
            - 句読点で改行することで音読時の呼吸を作る。
            - 大判ディスプレイの文字寄りでは縦揺れが目立つので palt + 行高1.4 で詰める。
          */}
          <h1 className="lp-serif-ja lp-pv-rise lp-pv-rise-2 mt-8 text-[2.05rem] leading-[1.45] font-medium text-[color:var(--lp-ink)] sm:text-[2.6rem] sm:leading-[1.4] lg:text-[3.1rem] lg:leading-[1.36]">
            候補者と、
            <wbr />
            <span className="relative inline-block">
              つながる。
              <span
                aria-hidden
                className="absolute right-1 -bottom-1 left-1 h-[7px] bg-[color:var(--lp-fuji-soft)]/45"
              />
            </span>
            <br />
            AIネイティブな、
            <wbr />
            採用CRM。
          </h1>
          <p className="lp-pv-rise lp-pv-rise-3 mt-10 max-w-lg text-[0.97rem] text-[color:var(--lp-ink-soft)]">
            候補者の状況をAIが要約し、次の一手を示す。
            <br className="hidden sm:inline" />
            求職者の動きは、リアルタイムで届く。
            <br className="hidden sm:inline" />
            中小転職エージェントのための、新しい採用管理。
          </p>
          <div className="lp-pv-rise lp-pv-rise-4 mt-14 flex flex-wrap items-center gap-5">
            <a href="#contact" className="lp-pv-cta group">
              お問い合わせ
              <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <Link href="/login" className="lp-pv-cta-ghost">
              ログインはこちら
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
        <div className="relative flex items-center justify-center">
          <StrataSignature />
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="lp-pv-strata-rule" aria-hidden />
      </div>
    </section>
  );
}

/**
 * ヒーロー右に置く新シグネチャー = 「ストラタ(層)」。
 *
 * 設計意図:
 * - 本番LPの「中央ハブ+左右の弧」が "情報が行き交う" を描いたのに対し、
 *   こちらは "情報の層をMairaが縦に貫く" 静的な構造で表現する。
 * - 上から:候補者の更新 → AIの要約 → Maira軸 → エージェントの行動 → 暗号化された記憶。
 * - 各層は細罫+小さなドット群。中央の縦軸は破線が下方向に流れる(prefers-reduced-motion で停止)。
 */
function StrataSignature() {
  // 各層を [y座標, en上ラベル, en下ラベル, ドット座標群] で宣言的に持つ。
  // ドット座標群:x位置の配列。サイズは index に応じて微妙に変えて単調さを避ける。
  const STRATA: Array<{ y: number; top: string; bottom: string; dots: number[] }> = [
    { y: 60, top: "Candidate", bottom: "Updates", dots: [40, 88, 132, 196, 260, 320, 372] },
    { y: 140, top: "AI", bottom: "Synthesis", dots: [56, 104, 164, 224, 284, 352] },
    { y: 280, top: "Agent", bottom: "Actions", dots: [48, 96, 160, 220, 284, 332, 380] },
    { y: 360, top: "Encrypted", bottom: "Memory", dots: [64, 120, 176, 232, 296, 348] },
  ];
  const CENTER_Y = 210;

  return (
    <svg
      viewBox="0 0 420 420"
      role="img"
      aria-label="情報の層をMairaの縦軸が貫く構造図"
      className="h-auto w-full max-w-[460px]"
    >
      <defs>
        <radialGradient id="lp-pv-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.62 0.16 290)" stopOpacity="0.12" />
          <stop offset="70%" stopColor="oklch(0.62 0.16 290)" stopOpacity="0.02" />
          <stop offset="100%" stopColor="oklch(0.62 0.16 290)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lp-pv-axis" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.205 0.045 265)" stopOpacity="0.1" />
          <stop offset="50%" stopColor="oklch(0.55 0.13 290)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="oklch(0.205 0.045 265)" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* 後光(層全体をやわらかく包む) */}
      <circle cx="210" cy="210" r="200" fill="url(#lp-pv-glow)" />

      {/* 各層 */}
      {STRATA.map((stratum) => (
        <g key={stratum.y}>
          {/* 水平の細罫 */}
          <line
            x1="20"
            y1={stratum.y}
            x2="400"
            y2={stratum.y}
            stroke="oklch(0.74 0.018 260)"
            strokeOpacity="0.35"
            strokeWidth="0.8"
          />
          {/* ドット群 */}
          {stratum.dots.map((x, i) => (
            <circle
              key={`${stratum.y}-${x}`}
              cx={x}
              cy={stratum.y}
              r={i % 3 === 1 ? 2.6 : 1.8}
              fill="oklch(0.205 0.045 265)"
              className="lp-pv-strata-dot"
              style={{ animationDelay: `${(i * 0.4 + stratum.y * 0.002).toFixed(2)}s` }}
            />
          ))}
          {/* ラベル(右側) */}
          <text
            x="408"
            y={stratum.y - 2}
            fontFamily="var(--font-lp-display), serif"
            fontSize="8"
            letterSpacing="0.28em"
            fill="oklch(0.55 0.02 258)"
            textAnchor="end"
          >
            {stratum.top.toUpperCase()}
          </text>
          <text
            x="408"
            y={stratum.y + 9}
            fontFamily="var(--font-lp-display), serif"
            fontSize="8"
            letterSpacing="0.28em"
            fill="oklch(0.55 0.02 258 / 0.7)"
            textAnchor="end"
          >
            {stratum.bottom.toUpperCase()}
          </text>
        </g>
      ))}

      {/* 中央のMaira層(他の層より太い罫で強調) */}
      <line
        x1="20"
        y1={CENTER_Y}
        x2="400"
        y2={CENTER_Y}
        stroke="oklch(0.205 0.045 265)"
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />

      {/* Maira軸:縦の破線(下方向にゆっくり流れる) */}
      <line
        x1="210"
        y1="36"
        x2="210"
        y2="384"
        stroke="url(#lp-pv-axis)"
        strokeWidth="1.4"
        className="lp-pv-axis"
      />

      {/* 中央ノード(Maira) */}
      <circle
        cx="210"
        cy={CENTER_Y}
        r="22"
        fill="oklch(0.985 0.005 90)"
        stroke="oklch(0.205 0.045 265)"
        strokeWidth="1.2"
      />
      <circle
        cx="210"
        cy={CENTER_Y}
        r="8"
        fill="oklch(0.55 0.13 290)"
        className="lp-pv-strata-core"
      />
      <text
        x="210"
        y={CENTER_Y + 42}
        textAnchor="middle"
        fontFamily="var(--font-lp-display), serif"
        fontSize="10.5"
        letterSpacing="0.32em"
        fill="oklch(0.36 0.028 262)"
      >
        MAIRA · AXIS
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* セクション共通 — スパイン                                          */
/* ------------------------------------------------------------------ */

/**
 * 各節の左端に置く背骨(スパイン)。
 * - 漢数字のインデックス + 細い縦罫で「これは文書の節である」ことを示す。
 * - モバイルでは縦罫を畳み、節題の上にインライン表示する(LpSpineInline)。
 */
function LpSpine({ kanji }: { kanji: string }) {
  return (
    <div className="hidden flex-col items-center pt-2 lg:flex" aria-hidden>
      <span className="lp-pv-spine-kanji">{kanji}</span>
      <span className="lp-pv-spine-rule mt-4 flex-1" />
    </div>
  );
}

function LpSpineInline({ kanji, label }: { kanji: string; label: string }) {
  return (
    <div className="flex items-center gap-4 lg:hidden">
      <span className="lp-pv-spine-kanji">{kanji}</span>
      <span aria-hidden className="h-px w-10 bg-[color:var(--lp-line-strong)]" />
      <span className="lp-serif-en text-[0.7rem] tracking-[0.32em] text-[color:var(--lp-ink-faint)] uppercase">
        {label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Challenge                                                           */
/* ------------------------------------------------------------------ */

function Challenge() {
  return (
    <section className="relative">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-28 lg:grid-cols-[40px_0.95fr_1.05fr] lg:gap-14 lg:px-8 lg:py-40">
        <LpSpine kanji="二" />
        <div className="flex flex-col gap-8">
          <LpSpineInline kanji="二" label="Present" />
          <span className="lp-serif-en hidden text-[0.7rem] tracking-[0.32em] text-[color:var(--lp-ink-faint)] uppercase lg:inline">
            Present — 現在地
          </span>
          <h2 className="lp-serif-ja text-[1.85rem] leading-[1.55] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
            その候補者、
            <br />
            最後にどうなりましたか?
          </h2>
          <p className="lp-serif-en text-[0.85rem] tracking-[0.05em] text-[color:var(--lp-ink-faint)] italic">
            — 管理が増えるほど、対話の時間が削られていく。
          </p>
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
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="lp-pv-strata-rule" aria-hidden />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Solution(台帳型 — カードではなく罫線で区切る3コラム)            */
/* ------------------------------------------------------------------ */

type SolutionEntry = {
  number: string;
  title: string;
  body: string;
};

const SOLUTION_ENTRIES: SolutionEntry[] = [
  {
    number: "i.",
    title: "AIが状況を要約する",
    body: "対応履歴、紹介中の求人、未着手のタスク。それらをAIが数秒で読み解き、いま何が起きていて、次にどんな一手が良いかまで示します。資料を開き直すたびに、頭の中を組み立て直す必要はもうありません。",
  },
  {
    number: "ii.",
    title: "求職者の動きが、自動で届く",
    body: "候補者がMaira上で職務経歴を更新したり、希望を見直したとき、エージェントの画面には静かに「更新あり」が灯ります。聞きに行かなくても、最新の候補者像が、いつもそこにある。",
  },
  {
    number: "iii.",
    title: "預かる情報を、構造から守る",
    body: "内面情報や悩みは、構造的にエージェントへは開示されません。候補者本人の同意があった範囲だけが届く設計。暗号化基盤の上で、信頼を仕組みとして担保します。",
  },
];

function Solution() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-5xl gap-10 px-6 py-28 lg:grid lg:grid-cols-[40px_1fr] lg:gap-14 lg:px-8 lg:py-40">
        <LpSpine kanji="三" />
        <div>
          <LpSpineInline kanji="三" label="Resolve" />
          <div className="mt-8 grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div>
              <span className="lp-serif-en hidden text-[0.7rem] tracking-[0.32em] text-[color:var(--lp-ink-faint)] uppercase lg:inline">
                Resolve — 解決の輪郭
              </span>
              <h2 className="lp-serif-ja mt-8 text-[1.85rem] leading-[1.55] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
                Mairaが、
                <br />
                その時間を返す。
              </h2>
            </div>
            <p className="self-end text-[0.97rem] text-[color:var(--lp-ink-soft)]">
              管理に追われる代わりに、候補者と向き合うための余白を取り戻す。
              AIネイティブに作り直された採用CRMが、エージェントの実務に静かに寄り添います。
            </p>
          </div>

          {/* 台帳:3コラムを縦罫で区切る。ボーダーは下と縦のみ。 */}
          <div className="mt-16 border-t border-[color:var(--lp-line-strong)]">
            <div className="grid gap-px overflow-hidden bg-[color:var(--lp-line)] md:grid-cols-3">
              {SOLUTION_ENTRIES.map((entry) => (
                <article
                  key={entry.number}
                  className="group flex flex-col gap-7 bg-[color:var(--lp-bg)] px-7 py-12 transition-colors hover:bg-[color:var(--lp-bg-tint)] sm:px-9 sm:py-14"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="lp-serif-en text-[1.6rem] tracking-[-0.01em] text-[color:var(--lp-fuji)] italic">
                      {entry.number}
                    </span>
                    <span
                      aria-hidden
                      className="h-px w-10 bg-[color:var(--lp-line-strong)] transition-all group-hover:w-20 group-hover:bg-[color:var(--lp-fuji)]"
                    />
                  </div>
                  <h3 className="lp-serif-ja text-[1.2rem] leading-[1.7] font-medium text-[color:var(--lp-ink)] sm:text-[1.3rem]">
                    {entry.title}
                  </h3>
                  <p className="text-[0.93rem] text-[color:var(--lp-ink-soft)]">{entry.body}</p>
                </article>
              ))}
            </div>
            <div className="border-b border-[color:var(--lp-line-strong)]" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="lp-pv-strata-rule" aria-hidden />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Features(目次型 — 縦リスト・タブラ)                              */
/* ------------------------------------------------------------------ */

type FeatureRow = {
  icon: React.ComponentType<{ className?: string }>;
  index: string;
  tag: string;
  title: string;
  body: string;
};

const FEATURE_ROWS: FeatureRow[] = [
  {
    icon: LayoutGrid,
    index: "01",
    tag: "Clients",
    title: "Excel風クライアント管理",
    body: "見慣れたグリッドで、候補者と求人を一覧できる。フィルタ、並べ替え、一括編集──業務の手触りを残したまま、AIで強化しました。",
  },
  {
    icon: Briefcase,
    index: "02",
    tag: "Matching",
    title: "求人マッチング・紹介管理",
    body: "希望と職歴を照らし合わせ、紹介すべき求人と理由を提示。紹介から面接、内定まで、ひとつのタイムラインで追えます。",
  },
  {
    icon: Sparkles,
    index: "03",
    tag: "Insights",
    title: "AI状況サマリー",
    body: "クライアントを開いた瞬間、AIが最新の状況を数行で要約。今日連絡すべき相手と、その理由が、画面の上から並びます。",
  },
  {
    icon: BarChart3,
    index: "04",
    tag: "Reports",
    title: "成約・売上レポート",
    body: "紹介数、面接率、成約金額。KPIを月次・四半期で可視化し、チームの動きを定量で把握できます。",
  },
];

function Features() {
  return (
    <section className="relative bg-[color:var(--lp-bg-tint)]">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-28 lg:grid-cols-[40px_1fr] lg:gap-14 lg:px-8 lg:py-40">
        <LpSpine kanji="四" />
        <div>
          <LpSpineInline kanji="四" label="Features" />
          <span className="lp-serif-en mt-2 hidden text-[0.7rem] tracking-[0.32em] text-[color:var(--lp-ink-faint)] uppercase lg:inline">
            Features — 機能
          </span>
          <h2 className="lp-serif-ja mt-6 text-[1.85rem] leading-[1.5] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
            日々の業務に、ちょうどいい。
          </h2>

          {/* 目次(タビュラ)型:見出し行 + 4行。各行は罫で区切る。 */}
          <div className="mt-16">
            <div className="hidden grid-cols-[68px_180px_1fr] items-baseline gap-8 border-b border-[color:var(--lp-line-strong)] pb-3 lg:grid">
              <span className="lp-pv-tab">No.</span>
              <span className="lp-pv-tab">Module</span>
              <span className="lp-pv-tab">Description</span>
            </div>
            <ul>
              {FEATURE_ROWS.map(({ icon: Icon, index, tag, title, body }) => (
                <li
                  key={index}
                  className="group grid grid-cols-1 gap-5 border-b border-[color:var(--lp-line)] py-10 transition-colors hover:bg-[color:var(--lp-bg)]/60 lg:grid-cols-[68px_180px_1fr] lg:items-start lg:gap-8"
                >
                  <div className="flex items-center gap-3 lg:flex-col lg:items-start lg:gap-5">
                    <span className="lp-serif-en text-[0.95rem] tracking-[0.18em] text-[color:var(--lp-fuji)]">
                      {index}
                    </span>
                    <span className="lp-pv-tab lg:hidden">{tag}</span>
                  </div>
                  <div className="flex items-center gap-4 lg:items-start">
                    <span className="flex size-9 items-center justify-center rounded-full border border-[color:var(--lp-line-strong)] bg-[color:var(--lp-bg)] text-[color:var(--lp-fuji)] transition-colors group-hover:border-[color:var(--lp-fuji)]">
                      <Icon className="size-4" />
                    </span>
                    <h3 className="lp-serif-ja text-[1.1rem] leading-[1.6] font-medium text-[color:var(--lp-ink)] sm:text-[1.2rem]">
                      {title}
                    </h3>
                  </div>
                  <p className="max-w-2xl text-[0.93rem] text-[color:var(--lp-ink-soft)]">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trust(中央・二重罫の証書)                                        */
/* ------------------------------------------------------------------ */

function Trust() {
  return (
    <section className="relative">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-28 lg:grid-cols-[40px_1fr] lg:gap-14 lg:px-8 lg:py-40">
        <LpSpine kanji="五" />
        <div>
          <LpSpineInline kanji="五" label="Trust" />
          <div className="lp-pv-frame mt-10 bg-[color:var(--lp-bg)]/70 text-center backdrop-blur-sm">
            <div className="mx-auto inline-flex items-center gap-3 rounded-full border border-[color:var(--lp-line-strong)] bg-[color:var(--lp-bg)] px-5 py-2 text-[color:var(--lp-fuji)]">
              <ShieldCheck className="size-4" />
              <span className="lp-serif-en text-[0.65rem] tracking-[0.3em] uppercase">
                Structural Trust
              </span>
            </div>
            <h2 className="lp-serif-ja mt-10 text-[1.85rem] leading-[1.55] font-medium text-[color:var(--lp-ink)] sm:text-[2.4rem]">
              候補者の信頼が、
              <br />
              エージェントの信頼に。
            </h2>
            <div className="mx-auto mt-12 max-w-2xl space-y-7 text-left text-[0.97rem] text-[color:var(--lp-ink-soft)] sm:text-center">
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
            {/* 証書の下端に小さなサイン */}
            <div className="mx-auto mt-12 flex max-w-xs items-center justify-center gap-4">
              <span className="h-px flex-1 bg-[color:var(--lp-line)]" />
              <span className="lp-serif-en text-[0.65rem] tracking-[0.3em] text-[color:var(--lp-ink-faint)] uppercase">
                Maira · 二〇二六
              </span>
              <span className="h-px flex-1 bg-[color:var(--lp-line)]" />
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="lp-pv-strata-rule" aria-hidden />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Contact                                                             */
/* ------------------------------------------------------------------ */

function Contact() {
  return (
    <section id="contact" className="relative scroll-mt-24">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-28 lg:grid-cols-[40px_1fr] lg:gap-14 lg:px-8 lg:py-40">
        <LpSpine kanji="六" />
        <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="flex flex-col">
            <LpSpineInline kanji="六" label="Form 06" />
            <span className="lp-serif-en mt-2 hidden text-[0.7rem] tracking-[0.32em] text-[color:var(--lp-ink-faint)] uppercase lg:inline">
              Form 06 — お問い合わせ
            </span>
            <h2 className="lp-serif-ja mt-6 text-[1.85rem] leading-[1.5] font-medium text-[color:var(--lp-ink)] sm:text-[2.3rem]">
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
                <span>株式会社Revorise</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="lp-serif-en tracking-[0.3em] uppercase">Reply</span>
                <span className="h-px flex-1 bg-[color:var(--lp-line)]" />
                <span>2 営業日以内</span>
              </div>
            </div>
          </div>
          <ContactForm />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer(オフホワイト継続 — 文書として最後まで切れない)            */
/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="border-t border-[color:var(--lp-line-strong)] bg-[color:var(--lp-bg)]">
      <div className="mx-auto grid max-w-5xl gap-12 px-6 py-16 lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-16 lg:px-8 lg:py-20">
        <div>
          <Link
            href="/"
            className="lp-serif-en text-[1.7rem] font-medium tracking-[-0.01em] text-[color:var(--lp-ink)]"
          >
            Maira
          </Link>
          <p className="mt-6 max-w-sm text-[0.85rem] leading-relaxed text-[color:var(--lp-ink-soft)]">
            候補者とつながる、AIネイティブな採用CRM。
            <br />
            中小転職エージェントのための採用管理。
          </p>
          <p className="lp-serif-en mt-8 text-[0.72rem] tracking-[0.22em] text-[color:var(--lp-ink-faint)] uppercase italic">
            Operated by Revorise Inc. · 二〇二六
          </p>
        </div>
        <div>
          <p className="lp-serif-en text-[0.65rem] tracking-[0.3em] text-[color:var(--lp-ink-faint)] uppercase">
            Product
          </p>
          <ul className="mt-5 space-y-3 text-[0.88rem] text-[color:var(--lp-ink-soft)]">
            <li>
              <Link
                href="/login"
                className="transition-colors hover:text-[color:var(--lp-fuji)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)]"
              >
                ログイン
              </Link>
            </li>
            <li>
              <a
                href="#contact"
                className="transition-colors hover:text-[color:var(--lp-fuji)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-fuji)]"
              >
                お問い合わせ
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="lp-serif-en text-[0.65rem] tracking-[0.3em] text-[color:var(--lp-ink-faint)] uppercase">
            Legal
          </p>
          <ul className="mt-5 space-y-3 text-[0.88rem] text-[color:var(--lp-ink-soft)]">
            <li>
              {/* 規約類は未整備のため、リンク枠だけ用意。整備時に href を差し替える */}
              <a
                href="#"
                aria-disabled="true"
                className="text-[color:var(--lp-ink-faint)] transition-colors hover:text-[color:var(--lp-fuji)]"
              >
                利用規約
              </a>
            </li>
            <li>
              <a
                href="#"
                aria-disabled="true"
                className="text-[color:var(--lp-ink-faint)] transition-colors hover:text-[color:var(--lp-fuji)]"
              >
                プライバシーポリシー
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[color:var(--lp-line)]">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-3 px-6 py-6 text-[0.72rem] text-[color:var(--lp-ink-faint)] sm:flex-row sm:items-center lg:px-8">
          <p>© 2026 Revorise Inc. All rights reserved.</p>
          <p className="lp-serif-en tracking-[0.28em] uppercase">— end of edition —</p>
        </div>
      </div>
    </footer>
  );
}
