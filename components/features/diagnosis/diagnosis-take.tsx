"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { aptitudeQuestions, type AptitudeQuestion } from "@/lib/diagnosis/aptitude-questions";
import { axisQuestions, type AxisQuestion } from "@/lib/diagnosis/axis-questions";

/**
 * 診断の回答UI(Client Component)
 *
 * - 26問(軸16 + 適性10)をフェーズ遷移で 1問ずつ表示する。
 *   1ページ内で state を持ち回り、Next の router 遷移は使わない。
 *   理由:途中遷移するとリロード等で回答が吹き飛ぶリスクがあるため。
 *   また、ステップB時点では永続化を実装しないので、ローカル state で十分。
 * - 軸→適性の間に区切り画面(interlude)を挟む。診断の心理的な切り替えと、
 *   何を測っているかをユーザーに伝えるため。
 * - 4段階回答(4=とても当てはまる / 3=当てはまる / 2=どちらでもない / 1=当てはまらない)。
 *   タップで即・次の質問へ進む(モバイル想定の標準パターン)。
 * - 「戻る」では回答を保持したまま戻り、選択済みの答えを再選択することで上書きできる。
 *   回答を消して戻すと、ユーザーが「直したいだけ」のケースで再入力を強いるため。
 */
type Phase = "axis" | "interlude" | "aptitude" | "done";

type DiagnosisAnswers = {
  axis: Record<string, number>;
  aptitude: Record<string, number>;
};

// 4段階スケール。中央値(2:どちらでもない)を残すのは、無理に YES/NO を強いると
// 回答精度が下がるため。値域 1〜4 は判定ロジック(ステップC)側でも使う。
const SCALE: { value: number; label: string }[] = [
  { value: 4, label: "とても当てはまる" },
  { value: 3, label: "当てはまる" },
  { value: 2, label: "どちらでもない" },
  { value: 1, label: "当てはまらない" },
];

export function DiagnosisTake() {
  const [phase, setPhase] = useState<Phase>("axis");
  const [axisIndex, setAxisIndex] = useState(0);
  const [aptitudeIndex, setAptitudeIndex] = useState(0);
  const [axis, setAxis] = useState<Record<string, number>>({});
  const [aptitude, setAptitude] = useState<Record<string, number>>({});

  const totalQuestions = axisQuestions.length + aptitudeQuestions.length;

  // 全体進捗を1本のバーで表す。フェーズ別の「回答済み数」を加算する。
  const answeredCount =
    phase === "axis"
      ? axisIndex
      : phase === "interlude"
        ? axisQuestions.length
        : phase === "aptitude"
          ? axisQuestions.length + aptitudeIndex
          : totalQuestions;
  const progressPct = Math.round((answeredCount / totalQuestions) * 100);

  function handleAnswerAxis(q: AxisQuestion, score: number) {
    setAxis({ ...axis, [q.id]: score });
    if (axisIndex + 1 < axisQuestions.length) {
      setAxisIndex(axisIndex + 1);
    } else {
      // 軸パート完了 → 区切り画面へ
      setPhase("interlude");
    }
  }

  function handleAnswerAptitude(q: AptitudeQuestion, score: number) {
    setAptitude({ ...aptitude, [q.id]: score });
    if (aptitudeIndex + 1 < aptitudeQuestions.length) {
      setAptitudeIndex(aptitudeIndex + 1);
    } else {
      setPhase("done");
    }
  }

  function handleBackAxis() {
    if (axisIndex === 0) return;
    setAxisIndex(axisIndex - 1);
  }

  function handleBackAptitude() {
    if (aptitudeIndex === 0) {
      // 適性の先頭で戻ると interlude(区切り)へ。軸へ直接戻さないのは
      // 区切りで「2パート構成だった」ことを再確認させるため。
      setPhase("interlude");
      return;
    }
    setAptitudeIndex(aptitudeIndex - 1);
  }

  function handleShowResult() {
    const answers: DiagnosisAnswers = { axis, aptitude };
    // ステップBでは判定・保存は未実装。ここで回答が正しく揃ったかを開発者が
    // 目視確認できるよう、console に吐く。ステップCで判定ロジック → ステップDで
    // 保存・結果画面に置き換える。
    // eslint-disable-next-line no-console
    console.log("DIAGNOSIS_ANSWERS", answers);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ProgressBar
        phase={phase}
        answeredCount={answeredCount}
        totalQuestions={totalQuestions}
        progressPct={progressPct}
      />

      {phase === "axis" && (
        <QuestionCard
          questionNumber={axisIndex + 1}
          totalInPart={axisQuestions.length}
          partLabel="キャリアの軸"
          text={axisQuestions[axisIndex].text}
          selected={axis[axisQuestions[axisIndex].id]}
          onSelect={(score) => handleAnswerAxis(axisQuestions[axisIndex], score)}
          onBack={axisIndex > 0 ? handleBackAxis : undefined}
        />
      )}

      {phase === "interlude" && (
        <Card className="space-y-4 p-6 text-center">
          <p className="text-2xl">✨</p>
          <p className="text-base font-medium">キャリアの軸の質問は以上です</p>
          <p className="text-muted-foreground text-sm">
            次は、あなたの「強み」について聞きます({aptitudeQuestions.length}問)
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setPhase("axis");
                setAxisIndex(axisQuestions.length - 1);
              }}
            >
              軸の最後に戻る
            </Button>
            <Button onClick={() => setPhase("aptitude")}>続けて受ける</Button>
          </div>
        </Card>
      )}

      {phase === "aptitude" && (
        <QuestionCard
          questionNumber={aptitudeIndex + 1}
          totalInPart={aptitudeQuestions.length}
          partLabel="あなたの強み"
          text={aptitudeQuestions[aptitudeIndex].text}
          selected={aptitude[aptitudeQuestions[aptitudeIndex].id]}
          onSelect={(score) => handleAnswerAptitude(aptitudeQuestions[aptitudeIndex], score)}
          onBack={handleBackAptitude}
        />
      )}

      {phase === "done" && (
        <Card className="space-y-4 p-6 text-center">
          <p className="text-2xl">🎉</p>
          <p className="text-base font-medium">すべての質問にお答えいただきました</p>
          <p className="text-muted-foreground text-sm">結果を確認しましょう</p>
          <div className="flex justify-center pt-2">
            <Button onClick={handleShowResult}>結果を見る</Button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            ※ 判定ロジック・結果画面は次のステップで実装します。
            <br />
            現時点では回答データをブラウザの console に出力します(開発者向け確認)。
          </p>
        </Card>
      )}

      <div className="flex justify-center">
        <Link
          href="/app/diagnosis"
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          診断を中断して入口に戻る
        </Link>
      </div>
    </div>
  );
}

function ProgressBar({
  phase,
  answeredCount,
  totalQuestions,
  progressPct,
}: {
  phase: Phase;
  answeredCount: number;
  totalQuestions: number;
  progressPct: number;
}) {
  const partLabel =
    phase === "axis"
      ? "1. キャリアの軸"
      : phase === "interlude"
        ? "1. キャリアの軸 完了"
        : phase === "aptitude"
          ? "2. あなたの強み"
          : "2. あなたの強み 完了";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{partLabel}</span>
        <span className="text-muted-foreground">
          {answeredCount} / {totalQuestions}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

type QuestionCardProps = {
  questionNumber: number;
  totalInPart: number;
  partLabel: string;
  text: string;
  selected: number | undefined;
  onSelect: (score: number) => void;
  onBack: (() => void) | undefined;
};

function QuestionCard({
  questionNumber,
  totalInPart,
  partLabel,
  text,
  selected,
  onSelect,
  onBack,
}: QuestionCardProps) {
  return (
    <Card className="space-y-5 p-6">
      <div>
        <p className="text-muted-foreground text-xs">
          {partLabel} ・ {questionNumber} / {totalInPart}
        </p>
        <p className="mt-2 text-base leading-relaxed">{text}</p>
      </div>

      {/* 回答ボタンは縦並びで大きめタップターゲット。モバイルで親指で押しやすくするため。 */}
      <div className="space-y-2">
        {SCALE.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              aria-pressed={isSelected}
              className={
                "w-full rounded-md border px-4 py-3 text-left text-sm transition-colors " +
                (isSelected ? "border-primary bg-primary/10" : "border-border hover:bg-muted")
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground underline"
          >
            ← 前の質問に戻る
          </button>
        ) : (
          <span />
        )}
        <span className="text-muted-foreground">直感で答えるのが正解です</span>
      </div>
    </Card>
  );
}
