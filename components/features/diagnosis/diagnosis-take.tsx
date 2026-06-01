"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { aptitudeQuestions, type AptitudeQuestion } from "@/lib/diagnosis/aptitude-questions";
import { axisQuestions, type AxisQuestion } from "@/lib/diagnosis/axis-questions";
import type { JobCategory } from "@/lib/diagnosis/job-mapping";
import {
  scoreAptitude,
  scoreAxis,
  suggestJobs,
  type AptitudeResult,
  type AxisResult,
} from "@/lib/diagnosis/scoring";

/**
 * 診断の回答 UI(Client Component)
 *
 * - 26問(軸16 + 適性10)をフェーズ遷移で 1問ずつ表示する。
 *   途中ルート遷移はしない(リロードで回答が消えるリスクを避けるため)。
 * - 軸→適性の間に区切り画面(interlude)を挟む。診断の心理的な切り替えと、
 *   何を測っているかをユーザーに伝えるため。
 * - 4段階回答(4=とても当てはまる / 3=当てはまる / 2=どちらでもない / 1=当てはまらない)。
 *   タップで即・次の質問へ進む(モバイル想定の標準パターン)。
 * - 「戻る」では回答を保持したまま戻り、選択済みの答えを再選択することで上書きできる。
 * - done → 結果を見る で:
 *   1. scoring を実行
 *   2. /api/diagnosis/explain で AI 説明文を取得
 *   3. /api/diagnosis/save で career_profile に保存
 *   4. /app/diagnosis/result に遷移(SSR で結果を描画)
 *   結果ページがあることで、リロード/共有/再訪に強い。
 */
type Phase = "axis" | "interlude" | "aptitude" | "done" | "submitting";

const SCALE: { value: number; label: string }[] = [
  { value: 4, label: "とても当てはまる" },
  { value: 3, label: "当てはまる" },
  { value: 2, label: "どちらでもない" },
  { value: 1, label: "当てはまらない" },
];

export function DiagnosisTake() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("axis");
  const [axisIndex, setAxisIndex] = useState(0);
  const [aptitudeIndex, setAptitudeIndex] = useState(0);
  const [axis, setAxis] = useState<Record<string, number>>({});
  const [aptitude, setAptitude] = useState<Record<string, number>>({});
  // submitting フェーズで進捗段階のテキストを出す。1=説明文生成 / 2=保存 / 3=遷移。
  const [submitStep, setSubmitStep] = useState<"explain" | "save" | "redirect" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const totalQuestions = axisQuestions.length + aptitudeQuestions.length;
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
      setPhase("interlude");
      return;
    }
    setAptitudeIndex(aptitudeIndex - 1);
  }

  async function submitDiagnosis(
    axisResult: AxisResult,
    aptitudeResult: AptitudeResult,
    jobCategories: JobCategory[],
    aptitudeHint: string,
  ) {
    // 1) 説明文 API
    setSubmitStep("explain");
    const explainRes = await fetch("/api/diagnosis/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryAxis: axisResult.primary,
        secondaryAxis: axisResult.secondary,
        topStrengths: aptitudeResult.topStrengths,
      }),
    });
    if (!explainRes.ok) {
      const body = (await explainRes.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(body.message ?? "説明文の生成に失敗しました");
    }
    const explainData = (await explainRes.json()) as {
      explanation: string;
      jobs?: JobCategory[];
    };

    // 2) 保存 API
    setSubmitStep("save");
    const saveRes = await fetch("/api/diagnosis/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        axis: {
          primary: axisResult.primary,
          secondary: axisResult.secondary,
          scores: axisResult.scores,
        },
        aptitude: {
          scores: aptitudeResult.scores,
          topStrengths: aptitudeResult.topStrengths,
        },
        jobs: {
          // サーバー側で再導出された jobs があればそちら、なければ client 計算分。
          categories: explainData.jobs ?? jobCategories,
          aptitudeHint,
        },
        explanation: explainData.explanation,
        createdAt: new Date().toISOString(),
      }),
    });
    if (!saveRes.ok) {
      throw new Error("結果の保存に失敗しました");
    }

    // 3) 結果ページへ遷移
    setSubmitStep("redirect");
    router.push("/app/diagnosis/result");
    router.refresh(); // SSR キャッシュを最新化
  }

  async function handleShowResult() {
    const axisResult = scoreAxis(axis);
    const aptitudeResult = scoreAptitude(aptitude);
    const jobSuggestion = suggestJobs(axisResult, aptitudeResult);

    setPhase("submitting");
    setSubmitError(null);
    try {
      await submitDiagnosis(
        axisResult,
        aptitudeResult,
        jobSuggestion.categories,
        jobSuggestion.aptitudeHint,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "予期しないエラーが発生しました";
      setSubmitError(message);
      // エラー時は done に戻して再試行可能にする
      setPhase("done");
      setSubmitStep(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {phase !== "submitting" && (
        <ProgressBar
          phase={phase}
          answeredCount={answeredCount}
          totalQuestions={totalQuestions}
          progressPct={progressPct}
        />
      )}

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
            次は、あなたの「強み」について聞きます({aptitudeQuestions.length}
            問)
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
          {submitError && <p className="text-destructive text-sm">{submitError}</p>}
          <div className="flex justify-center pt-2">
            <Button onClick={handleShowResult}>結果を見る</Button>
          </div>
        </Card>
      )}

      {phase === "submitting" && (
        <Card className="space-y-4 p-8 text-center">
          <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-base font-medium">結果を準備しています</p>
          <p className="text-muted-foreground text-sm">
            {submitStep === "explain"
              ? "あなた向けの説明文を生成中..."
              : submitStep === "save"
                ? "結果を保存しています..."
                : "結果画面へ移動します..."}
          </p>
        </Card>
      )}

      {phase !== "submitting" && (
        <div className="flex justify-center">
          <Link
            href="/app/diagnosis"
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            診断を中断して入口に戻る
          </Link>
        </div>
      )}
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
