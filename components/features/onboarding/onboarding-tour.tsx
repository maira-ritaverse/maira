"use client";

import { useState, useEffect } from "react";
import { Joyride, type EventData, type Step } from "react-joyride";

type Props = {
  /**
   * 自動起動するかどうか(初回ログイン時のみ true)
   */
  autoStart: boolean;

  /**
   * 手動起動用(外部から制御する場合)。
   * Phase 3 で「ツアーを再表示」ボタンから利用する想定。
   */
  forceStart?: boolean;

  /**
   * 起動状態を外部に通知(forceStart と組み合わせて使用)
   */
  onClose?: () => void;
};

/**
 * Maira オンボーディングツアー(10ステップ)
 *
 * 初回ログイン時または「ツアーを再表示」から起動する。
 * 各ステップは画面上の特定要素を target にして強調表示する。
 *
 * react-joyride は client-only なため "use client" を付与している。
 *
 * v3 API メモ:
 * - Joyride は named export
 * - コールバックは onEvent(callback ではない)、引数は EventData
 * - showProgress / buttons / primaryColor / zIndex は options 配下
 * - スキップボタンは options.buttons に "skip" を含めることで表示
 * - locale は SharedProps なので Joyride props のトップレベル
 * - showProgress 有効時の primary ボタンラベルは locale.next ではなく
 *   locale.nextWithProgress を使うため、日本語化は両方設定が必要。
 */
export function OnboardingTour({ autoStart, forceStart = false, onClose }: Props) {
  const [run, setRun] = useState(false);

  // 10ステップのツアー内容。target は data-tour 属性で参照する。
  // 画面中央表示(モーダル風)にしたいステップは target: "body" + placement: "center"。
  // 順序は現行サイドバーの推奨フロー(診断 → 棚卸し → 書類作成)に合わせる。
  const steps: Step[] = [
    // ステップ1:ようこそ(画面中央)
    {
      target: "body",
      placement: "center",
      title: "Mairaへようこそ",
      content: (
        <div className="space-y-2">
          <p>Mairaは、あなたの転職活動を24時間伴走するAI採用エージェントです。</p>
          <p className="text-muted-foreground text-sm">これから主な機能をご案内します(2-3分)</p>
        </div>
      ),
    },
    // ステップ2:ダッシュボード(画面中央表示)
    // 元は dashboard-content を target にして placement: "top" を指定していたが、
    // 対象 div がページ高さほぼ全域に及ぶため、tooltip がビューポート外に押し出され
    // スクロールしないと「次へ」ボタンが見えない状態だった。
    // ダッシュボード自体は背景にそのまま見えているので、ステップ1と同様に
    // body + center で説明文だけを表示する形に変更している。
    {
      target: "body",
      placement: "center",
      title: "ここがダッシュボードです",
      content: (
        <div className="space-y-2">
          <p>ログインすると、まずこの画面が表示されます。</p>
          <p>
            あなたの現在の状況に応じて、Mairaからの提案や、進行中の応募・タスクが一目で分かります。
          </p>
        </div>
      ),
    },
    // ステップ3:サイドバー全体(現行ナビ構成に合わせて例示を更新)
    {
      target: '[data-tour="sidebar"]',
      placement: "right",
      title: "サイドバーから各機能へ",
      content: (
        <div className="space-y-2">
          <p>主要機能はここからアクセスできます。</p>
          <p className="text-muted-foreground text-sm">
            キャリア診断 / キャリア棚卸し / 書類作成 / 応募管理 など
          </p>
        </div>
      ),
    },
    // ステップ4:キャリア診断(新規)。サイドバー順序に合わせて棚卸しの前に置く。
    {
      target: '[data-tour="nav-diagnosis"]',
      placement: "right",
      title: "まずはキャリア診断から",
      content: (
        <div className="space-y-2">
          <p>
            あなたの強みや向いている方向を、まず診断で把握します。数分の質問に答えると、適性が5つの軸で可視化されます。
          </p>
        </div>
      ),
    },
    // ステップ5:キャリア棚卸し(旧ステップ4から移動・文言更新)
    {
      target: '[data-tour="nav-career"]',
      placement: "right",
      title: "次にキャリア棚卸し",
      content: (
        <div className="space-y-2">
          <p>
            Mairaと5-10分話すだけで、あなたの強み・価値観・希望が整理されます。診断結果も踏まえて深掘りし、ここで作った情報は書類作成や応募相談に自動で活用されます。
          </p>
        </div>
      ),
    },
    // ステップ6:志望動機・自己PR(サイドバー表記に合わせる。
    // 履歴書・職務経歴書は後続ステップで個別に紹介するため、ここでは触れない)
    {
      target: '[data-tour="nav-documents"]',
      placement: "right",
      title: "志望動機・自己PR",
      content: (
        <div className="space-y-2">
          <p>棚卸し結果から、志望動機・自己PRを自動生成できます。</p>
        </div>
      ),
    },
    // ステップ7:履歴書
    {
      target: '[data-tour="nav-resumes"]',
      placement: "right",
      title: "履歴書",
      content: (
        <div className="space-y-2">
          <p>厚労省推奨様式に沿った履歴書を作成・管理できます。</p>
          <p className="text-muted-foreground text-sm">
            プロフィール情報を再利用するので、何度も同じ項目を入力する必要はありません。
          </p>
        </div>
      ),
    },
    // ステップ8:職務経歴書
    {
      target: '[data-tour="nav-cvs"]',
      placement: "right",
      title: "職務経歴書",
      content: (
        <div className="space-y-2">
          <p>JIS様式想定の職務経歴書を作成・管理できます。</p>
          <p className="text-muted-foreground text-sm">
            棚卸しで整理した経験を元に、応募先ごとの最適化もしやすくなります。
          </p>
        </div>
      ),
    },
    // ステップ8.5:AI ヒアリング(音声からの履歴書/職務経歴書自動生成)
    {
      target: '[data-tour="nav-career-intake"]',
      placement: "right",
      title: "AI ヒアリングで自動生成",
      content: (
        <div className="space-y-2">
          <p>
            キャリア面談の音声をアップロードすると、AI が文字起こし → 構造化抽出 →
            履歴書/職務経歴書の下書きまで一括で行います。
          </p>
          <p className="text-muted-foreground text-sm">
            証明写真も「自撮りを AI で証明写真化(履歴書編集ページ)」する機能があります。
          </p>
        </div>
      ),
    },
    // ステップ8.6:AI 求人推薦
    {
      target: '[data-tour="nav-recommended-jobs"]',
      placement: "right",
      title: "AI 求人推薦",
      content: (
        <div className="space-y-2">
          <p>
            連携したエージェンシーの公開求人から、棚卸し + 診断結果に基づいて AI が TOP 5
            をランキングします。
          </p>
          <p className="text-muted-foreground text-sm">
            「興味あり」「応募を依頼」のワンタップで、エージェントに意向が伝わります。
          </p>
        </div>
      ),
    },
    // ステップ8.7:エージェント推薦進捗
    {
      target: '[data-tour="nav-agent-referrals"]',
      placement: "right",
      title: "エージェントの推薦進捗",
      content: (
        <div className="space-y-2">
          <p>エージェンシーが進めている書類選考・面接などのステータスを一覧で確認できます。</p>
          <p className="text-muted-foreground text-sm">
            進捗が動いたら通知ベル(右上)でお知らせします。
          </p>
        </div>
      ),
    },
    // ステップ9:ユーザーメニュー
    {
      target: '[data-tour="user-menu"]',
      placement: "bottom",
      title: "アカウント管理はここから",
      content: (
        <div className="space-y-2">
          <p>右上のメニューから、設定変更やログアウトができます。</p>
        </div>
      ),
    },
    // ステップ10:完了(画面中央)
    {
      target: "body",
      placement: "center",
      title: "準備完了です",
      content: (
        <div className="space-y-2">
          <p>ツアーは以上です。まずはキャリア診断から始めてみましょう。</p>
          <p className="text-muted-foreground text-sm">
            分からないことがあれば、設定からこのツアーを再表示できます。
          </p>
        </div>
      ),
    },
  ];

  useEffect(() => {
    if (autoStart || forceStart) {
      // ハイドレーション完了を待つために少し遅らせる。
      // 即時 setRun(true) すると、target 要素が DOM に存在せず joyride 内部でエラーになるケースがある。
      const timer = setTimeout(() => setRun(true), 500);
      return () => clearTimeout(timer);
    }
  }, [autoStart, forceStart]);

  const handleEvent = async (event: EventData) => {
    const status = event.status;

    // ツアー完了またはスキップ時に状態を確定する。
    // STATUS の値はリテラル "finished" / "skipped"。
    if (status === "finished" || status === "skipped") {
      setRun(false);

      // 完了 API は「自動起動(=初回)」のときだけ呼ぶ。
      // 再表示(forceStart)時は onboarded_at を再書き込みしない。
      if (autoStart) {
        try {
          await fetch("/api/onboarding/complete", { method: "POST" });
        } catch (err) {
          // ネットワーク失敗時はサイレントに残す。次回ログイン時にまた起動するだけなので致命的ではない。
          console.error("Failed to mark onboarding complete:", err);
        }
      }

      onClose?.();
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      onEvent={handleEvent}
      locale={{
        back: "戻る",
        close: "閉じる",
        last: "完了",
        next: "次へ",
        // showProgress 有効時の primary ボタンは next ではなく nextWithProgress を参照する。
        // 未設定だと英語デフォルト "Next ({current} of {total})" にフォールバックしてしまう。
        nextWithProgress: "次へ ({current} / {total})",
        skip: "スキップ",
      }}
      options={{
        // shadcn v4 / Tailwind v4 では --primary が oklch(...) のため、
        // hsl(var(--primary)) と書くと hsl(oklch(...)) になり CSS が破棄される。
        // 結果、buttonPrimary が白背景に白文字となり「次へ」ボタンが見えなくなるので、
        // var(--primary) を直接渡して oklch 値をそのまま使う。
        primaryColor: "var(--primary)",
        zIndex: 10000,
        showProgress: true,
        buttons: ["skip", "back", "primary"],
      }}
    />
  );
}
