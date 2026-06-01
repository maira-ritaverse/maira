// 診断の判定ロジック。
//
// 設計方針:
// - 軸:8タイプの合計スコアから「主軸 + 僅差の次点」を出す。
//   autonomy / lifestyle のような近接タイプが同程度になるケースを、
//   secondary で自然に拾えるようにするため。
// - 適性:5因子のスコアを残しつつ、「上位の強み」を強調する。
//   ユーザーに「あなたの強み」として提示するため、上位のみ抜き出す。
// - 職種:固定マッピング(axisToJobs)からのみ選び、AIに捏造させない。

import { aptitudeQuestions, type AptitudeFactor } from "./aptitude-questions";
import { axisQuestions, type AxisType } from "./axis-questions";
import { aptitudeJobHints, axisToJobs, type JobCategory } from "./job-mapping";

export type AxisResult = {
  primary: AxisType;
  // 主軸との差が小さければ secondary も提示する(僅差なら2軸併記)。
  // 差が大きければ null。
  secondary: AxisType | null;
  scores: Record<AxisType, number>;
};

export type AptitudeResult = {
  // 全因子のスコア。レーダーチャート用(ステップDで使う)。
  // 各因子は2問×最大4点 = 最大8点。
  scores: Record<AptitudeFactor, number>;
  // 上位の強み。1位スコアの 80% 以上のものを最大3個まで。
  // 80% という閾値は、回答がフラットでも上位2-3個に絞り込めるようにするための実務値。
  topStrengths: AptitudeFactor[];
};

export type JobSuggestion = {
  categories: JobCategory[];
  // 上位の適性に紐づく短いヒント(AI説明文の根拠として渡す)。
  aptitudeHint: string;
};

// secondary を採用する閾値:主軸の 80% 以上なら「次点」として並べる。
// これより小さい比率だと「ほぼ無関係な軸」が出てしまい、診断結果がぼやけるため。
const SECONDARY_AXIS_THRESHOLD = 0.8;

// topStrengths を採用する閾値:1位の 80% 以上のものに絞る。
// 同じ理由(無関係な強みを混ぜないため)。
const TOP_STRENGTH_THRESHOLD = 0.8;

// ゼロ初期化された軸スコアを返す。Object.entries の出力順を安定させるため
// 関数で明示的に定義する。
function emptyAxisScores(): Record<AxisType, number> {
  return {
    specialist: 0,
    management: 0,
    autonomy: 0,
    security: 0,
    entrepreneur: 0,
    service: 0,
    challenge: 0,
    lifestyle: 0,
  };
}

function emptyAptitudeScores(): Record<AptitudeFactor, number> {
  return {
    openness: 0,
    conscientiousness: 0,
    extraversion: 0,
    agreeableness: 0,
    stability: 0,
  };
}

export function scoreAxis(answers: Record<string, number>): AxisResult {
  const scores = emptyAxisScores();
  for (const q of axisQuestions) {
    const a = answers[q.id];
    // 未回答や不正値はスキップ(UI が全問必須にしているが、防御的に)。
    if (typeof a === "number" && a >= 1 && a <= 4) {
      scores[q.type] += a;
    }
  }

  // 降順ソート。同点時は Object.entries の出現順(=emptyAxisScores の定義順)で安定。
  const sorted = (Object.entries(scores) as [AxisType, number][]).sort(([, a], [, b]) => b - a);

  const primary = sorted[0][0];
  const top = sorted[0][1];
  const second = sorted[1];
  // 主軸が 0 点なら secondary は出さない(全く回答がない/異常値ケース)。
  const secondary = top > 0 && second[1] >= top * SECONDARY_AXIS_THRESHOLD ? second[0] : null;

  return { primary, secondary, scores };
}

export function scoreAptitude(answers: Record<string, number>): AptitudeResult {
  const scores = emptyAptitudeScores();
  for (const q of aptitudeQuestions) {
    const a = answers[q.id];
    if (typeof a === "number" && a >= 1 && a <= 4) {
      scores[q.factor] += a;
    }
  }

  const sorted = (Object.entries(scores) as [AptitudeFactor, number][]).sort(
    ([, a], [, b]) => b - a,
  );
  const top = sorted[0][1];

  // 全 0 点なら強みは空(防御)。それ以外は 1 位の 80% 以上のものを上位3個まで採用。
  const topStrengths: AptitudeFactor[] =
    top > 0
      ? sorted
          .filter(([, s]) => s >= top * TOP_STRENGTH_THRESHOLD)
          .slice(0, 3)
          .map(([k]) => k)
      : [];

  return { scores, topStrengths };
}

export function suggestJobs(axisResult: AxisResult, aptitudeResult: AptitudeResult): JobSuggestion {
  // primary 軸の職種候補をすべて。secondary 軸があれば、その先頭1つを追加で混ぜる。
  // secondary を全部混ぜないのは、候補が増えすぎて「向いている方向」がぼやけるため。
  const primaryJobs = axisToJobs[axisResult.primary];
  const secondaryJobs = axisResult.secondary ? axisToJobs[axisResult.secondary].slice(0, 1) : [];

  // 同じ職種名が両軸で被ることがある(例:コンサルタント)。name で重複排除。
  const seen = new Set<string>();
  const categories: JobCategory[] = [];
  for (const job of [...primaryJobs, ...secondaryJobs]) {
    if (!seen.has(job.name)) {
      seen.add(job.name);
      categories.push(job);
    }
  }

  // 適性ヒントは「最も強い因子」のもの1本に絞る。説明文の根拠として使う。
  const topFactor = aptitudeResult.topStrengths[0];
  const aptitudeHint = topFactor ? aptitudeJobHints[topFactor] : "";

  return { categories, aptitudeHint };
}

// ステップDで career_profile に保存する想定の、結果の完全型。
// ステップCではこの型で結果オブジェクトを組み立てて画面に渡す。
export type DiagnosisResult = {
  axis: AxisResult;
  aptitude: AptitudeResult;
  jobs: JobSuggestion;
  explanation: string; // AI 生成の説明文
  createdAt: string; // ISO 8601
};
