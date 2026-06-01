"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  aptitudeQuestions,
  aptitudeStrengthLabels,
  type AptitudeQuestion,
} from "@/lib/diagnosis/aptitude-questions";
import { axisQuestions, axisTypeLabels, type AxisQuestion } from "@/lib/diagnosis/axis-questions";
import type { JobCategory } from "@/lib/diagnosis/job-mapping";
import {
  scoreAptitude,
  scoreAxis,
  suggestJobs,
  type AptitudeResult,
  type AxisResult,
  type JobSuggestion,
} from "@/lib/diagnosis/scoring";

/**
 * 診断の回答 + 結果表示 UI(Client Component)
 *
 * - 26問(軸16 + 適性10)をフェーズ遷移で 1問ずつ表示する。
 *   1ページ内で state を持ち回り、Next の router 遷移は使わない。
 *   理由:途中遷移するとリロード等で回答が吹き飛ぶリスクがあるため。
 *   また、ステップCまでは永続化を実装しないので、ローカル state で十分。
 * - 軸→適性の間に区切り画面(interlude)を挟む。診断の心理的な切り替えと、
 *   何を測っているかをユーザーに伝えるため。
 * - 4段階回答(4=とても当てはまる / 3=当てはまる / 2=どちらでもない / 1=当てはまらない)。
 *   タップで即・次の質問へ進む(モバイル想定の標準パターン)。
 * - 「戻る」では回答を保持したまま戻り、選択済みの答えを再選択することで上書きできる。
 *   回答を消して戻すと、ユーザーが「直したいだけ」のケースで再入力を強いるため。
 * - done → 結果を見る で scoring を実行し、AI 説明文 API を呼ぶ。
 *   ステップDで「保存」を追加するまでは、表示のみ。
 */
type Phase = "axis" | "interlude" | "aptitude" | "done" | "result";

type ComputedResult = {
  axis: AxisResult;
  aptitude: AptitudeResult;
  jobs: JobSuggestion;
};

// 4段階スケール。中央値(2:どちらでもない)を残すのは、無理に YES/NO を強いると
// 回答精度が下がるため。値域 1〜4 は scoring 側でも使う。
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

  // result フェーズ用の state
  const [computed, setComputed] = useState<ComputedResult | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  // サーバー側が再導出して返した職種(client 計算と一致するはず。職種捏造を二重に防ぐ
  // ため、表示はサーバー側のものを優先する)。
  const [serverJobs, setServerJobs] = useState<JobCategory[] | null>(null);

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

  async function fetchExplanation(axisResult: AxisResult, aptitudeResult: AptitudeResult) {
    setExplainLoading(true);
    setExplainError(null);
    try {
      const res = await fetch("/api/diagnosis/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryAxis: axisResult.primary,
          secondaryAxis: axisResult.secondary,
          topStrengths: aptitudeResult.topStrengths,
        }),
      });
      if (!res.ok) {
        // サーバーは categorizeAIError 経由で message を返してくる(ユーザー向け文言)。
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        explanation: string;
        jobs?: JobCategory[];
      };
      setExplanation(data.explanation);
      setServerJobs(data.jobs ?? null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "説明文の生成に失敗しました";
      setExplainError(message);
    } finally {
      setExplainLoading(false);
    }
  }

  function handleShowResult() {
    // scoring は同期で軽い。先にローカルで計算 → result フェーズへ遷移 →
    // 並行で AI 説明文を取りに行く(結果の骨組みはすぐ見える、説明文だけ後追い表示)。
    const axisResult = scoreAxis(axis);
    const aptitudeResult = scoreAptitude(aptitude);
    const jobs = suggestJobs(axisResult, aptitudeResult);
    setComputed({ axis: axisResult, aptitude: aptitudeResult, jobs });
    setPhase("result");
    void fetchExplanation(axisResult, aptitudeResult);
  }

  function handleRetryExplanation() {
    if (!computed) return;
    void fetchExplanation(computed.axis, computed.aptitude);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {phase !== "result" && (
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
          <div className="flex justify-center pt-2">
            <Button onClick={handleShowResult}>結果を見る</Button>
          </div>
        </Card>
      )}

      {phase === "result" && computed && (
        <ResultView
          computed={computed}
          serverJobs={serverJobs}
          explanation={explanation}
          explainLoading={explainLoading}
          explainError={explainError}
          onRetry={handleRetryExplanation}
        />
      )}

      <div className="flex justify-center">
        <Link
          href="/app/diagnosis"
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          {phase === "result" ? "診断トップに戻る" : "診断を中断して入口に戻る"}
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

type ResultViewProps = {
  computed: ComputedResult;
  serverJobs: JobCategory[] | null;
  explanation: string | null;
  explainLoading: boolean;
  explainError: string | null;
  onRetry: () => void;
};

function ResultView({
  computed,
  serverJobs,
  explanation,
  explainLoading,
  explainError,
  onRetry,
}: ResultViewProps) {
  // サーバー側で再導出された職種があればそちらを優先。職種捏造の二重防止。
  const jobs = serverJobs ?? computed.jobs.categories;

  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-6">
        <div>
          <p className="text-muted-foreground text-xs">あなたの軸</p>
          <p className="mt-1 text-lg font-semibold">{axisTypeLabels[computed.axis.primary]}</p>
          {computed.axis.secondary && (
            <p className="text-muted-foreground mt-1 text-sm">
              次いで {axisTypeLabels[computed.axis.secondary]}(僅差)
            </p>
          )}
        </div>

        <div>
          <p className="text-muted-foreground text-xs">あなたの強み</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {computed.aptitude.topStrengths.length > 0 ? (
              computed.aptitude.topStrengths.map((f) => (
                <span
                  key={f}
                  className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-medium"
                >
                  {aptitudeStrengthLabels[f]}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground text-xs">強みが拮抗しています</span>
            )}
          </div>
        </div>

        <div>
          <p className="text-muted-foreground text-xs">向いている職種カテゴリ(候補)</p>
          <ul className="mt-2 space-y-1.5">
            {jobs.map((j) => (
              <li
                key={j.name}
                className="border-border flex flex-col rounded-md border px-3 py-2 text-sm"
              >
                <span className="font-medium">{j.name}</span>
                <span className="text-muted-foreground mt-0.5 text-xs">{j.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card className="p-6">
        <p className="text-muted-foreground text-xs">あなたへ</p>
        {explainLoading && (
          <div className="mt-3 space-y-2">
            <div className="bg-muted h-3 w-full animate-pulse rounded" />
            <div className="bg-muted h-3 w-5/6 animate-pulse rounded" />
            <div className="bg-muted h-3 w-4/6 animate-pulse rounded" />
            <p className="text-muted-foreground mt-3 text-xs">説明文を生成しています...</p>
          </div>
        )}
        {explainError && !explainLoading && (
          <div className="mt-3 space-y-2">
            <p className="text-destructive text-sm">{explainError}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              もう一度試す
            </Button>
          </div>
        )}
        {explanation && !explainLoading && !explainError && (
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{explanation}</p>
        )}
      </Card>

      <p className="text-muted-foreground text-center text-xs leading-relaxed">
        ※ 結果の保存とレーダーチャートは次のステップで実装します。
        <br />
        提示される職種は「向いている方向の候補」であり、可能性を狭めるものではありません。
      </p>
    </div>
  );
}
