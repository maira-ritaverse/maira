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
 * Maira オンボーディングツアー(8ステップ)
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

  // 8ステップのツアー内容。target は data-tour 属性で参照する。
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
    // ステップ2:ダッシュボード本体
    {
      target: '[data-tour="dashboard-content"]',
      placement: "top",
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
    // ステップ6:書類作成(旧ステップ5から文言修正。履歴書/職務経歴書は別メニューに分かれている現状に合わせる)
    {
      target: '[data-tour="nav-documents"]',
      placement: "right",
      title: "書類作成",
      content: (
        <div className="space-y-2">
          <p>棚卸し結果から、志望動機・自己PRを自動生成できます。</p>
          <p className="text-muted-foreground text-sm">
            履歴書・職務経歴書は専用メニューから作成できます。
          </p>
        </div>
      ),
    },
    // ステップ7:ユーザーメニュー
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
    // ステップ8:完了(画面中央)
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
        primaryColor: "hsl(var(--primary))",
        zIndex: 10000,
        showProgress: true,
        buttons: ["skip", "back", "primary"],
      }}
    />
  );
}
