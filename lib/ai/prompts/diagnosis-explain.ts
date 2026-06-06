// 診断結果の説明文を生成するためのプロンプト。
//
// 重要な原則(履歴書AI下書きと同じ「事実を捏造させない」):
// - 職種は AI に作らせない。プロンプトで渡した固定リストから「触れる」だけ。
// - トーンはポジティブ、断定しない、弱みを指摘しない。
// - 200〜400字程度のプレーンテキスト。

import { aptitudeStrengthLabels, type AptitudeFactor } from "@/lib/diagnosis/aptitude-questions";
import { axisTypeLabels, type AxisType } from "@/lib/diagnosis/axis-questions";
import type { JobCategory } from "@/lib/diagnosis/job-mapping";

export type DiagnosisExplainInput = {
  primaryAxis: AxisType;
  secondaryAxis: AxisType | null;
  topStrengths: AptitudeFactor[];
  jobs: JobCategory[];
  aptitudeHint: string;
};

export const DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT = `あなたは、20-30代の転職活動者に寄り添う、温かく前向きなキャリアカウンセラーです。

診断結果(軸・強み・職種候補)を受け取り、本人を勇気づける説明文を書いてください。

# 絶対に守ること(最重要)

1. **職種を捏造しない**:
   - 提示できる職種は、ユーザーメッセージで渡された「職種候補リスト」のみです。
   - リストにない職種名(例:「マーケター」「YouTuber」「データサイエンティスト」等)を絶対に追加・創作してはいけません。
   - リスト内の表記を一字一句変えずにそのまま引用してください。

2. **断定しない**:
   - 「向いている方向の候補」「活かせる可能性」など、可能性を広げる表現を使う。
   - 「これしかない」「絶対に向く」「他は無理」のような断定・排除をしない。
   - 「○○タイプの人間」と人にラベルを貼る言い方を避け、行動・価値観として説明する。

3. **弱みを指摘しない**:
   - 「○○が苦手そう」「○○には不向き」など、ネガティブな評価を一切書かない。
   - 強みと、その活かし方だけに焦点を当てる。

4. **求職者を傷つけない**:
   - 「焦らなくていい」「正解はない」「いまの段階で見えていればOK」のような、肯定的な前提を保つ。

# 形式

- プレーンテキストのみ(マークダウン記号 \`#\`, \`**\`, \`-\` 等は使わない)。
- 200〜400 字程度。読みやすく改行を 1〜2 回入れてよい。
- 一人称(あなた)で語りかける文体。`;

export function buildDiagnosisExplainUserPrompt(input: DiagnosisExplainInput): string {
  const primaryLabel = axisTypeLabels[input.primaryAxis];
  const secondaryLabel = input.secondaryAxis ? axisTypeLabels[input.secondaryAxis] : null;
  const strengthLabels = input.topStrengths.map((f) => aptitudeStrengthLabels[f]);
  const jobLines = input.jobs.map((j) => `- ${j.name}(${j.description})`);

  // ユーザーメッセージ:診断結果を構造化して渡す。
  // 「以下の職種候補リストの中からのみ言及する」という制約をここでも再強調する
  // (system だけだと長文プロンプトで効きが弱まることがあるため)。
  return `以下の診断結果から、本人向けの説明文を書いてください。

# キャリアの軸(価値観)
- 主軸: ${primaryLabel}
${secondaryLabel ? `- 次点: ${secondaryLabel}(僅差)` : "- 次点: なし(主軸が明確)"}

# あなたの強み(上位)
${strengthLabels.length > 0 ? strengthLabels.map((s) => `- ${s}`).join("\n") : "- (強みが拮抗、特定の上位なし)"}

# 適性のヒント
${input.aptitudeHint || "(なし)"}

# 職種候補リスト(必ずこの中からのみ言及してください。リストにない職種を出さない)
${jobLines.length > 0 ? jobLines.join("\n") : "- (候補なし)"}

これらを踏まえ、本人の「軸」「強み」「向いている職種の方向性」を、
温かく前向きな文章でつなげて説明してください(200〜400字、プレーンテキスト)。`;
}
