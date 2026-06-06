// 診断2(適性):ビッグファイブ5因子を判定するための設問データ。
// 各因子2問、計10問。回答は4段階(4: とても当てはまる 〜 1: 当てはまらない)。
//
// 第5因子は本来「神経症傾向(Neuroticism)」だが、ここでは反転して「情緒安定性」
// として測る。理由:診断結果はポジティブに(強みを発見)提示する方針のため、
// 「神経症傾向が高い」よりも「情緒安定性が高い/低い」のほうがユーザーに伝えやすい。

export type AptitudeFactor =
  | "openness" // 開放性
  | "conscientiousness" // 誠実性
  | "extraversion" // 外向性
  | "agreeableness" // 協調性
  | "stability"; // 情緒安定性(神経症傾向の反転)

export type AptitudeQuestion = {
  id: string;
  text: string;
  factor: AptitudeFactor;
};

// 各因子を「強み」として表現するためのラベル。
// 学術用語(開放性・誠実性...)ではなく、ユーザーに「自分の強み」として
// 受け取ってもらいやすい行動レベルの表現に置き換える。
export const aptitudeStrengthLabels: Record<AptitudeFactor, string> = {
  openness: "発想力・変化対応",
  conscientiousness: "責任感・継続力",
  extraversion: "コミュニケーション力・行動力",
  agreeableness: "チームワーク・サポート力",
  stability: "冷静さ・ストレス耐性",
};

// 因子ごとの表示色。--chart-1〜5(globals.css 定義済み・ダーク/ライト両対応)を
// 順番固定で割当てる。レーダーチャートのドット/軸ラベルと、強みバッジで共通に
// 使い、「この色 = この因子」を視覚的に紐付けるための単一のソース。
// 順番を変えると見え方が変わるので、ここを唯一の真実とする。
export const aptitudeFactorChartVars: Record<AptitudeFactor, string> = {
  openness: "var(--chart-1)",
  conscientiousness: "var(--chart-2)",
  extraversion: "var(--chart-3)",
  agreeableness: "var(--chart-4)",
  stability: "var(--chart-5)",
};

export const aptitudeQuestions: AptitudeQuestion[] = [
  { id: "ap01", factor: "openness", text: "新しいことや、やったことのない方法に挑戦するのが好き" },
  { id: "ap02", factor: "openness", text: "決まったやり方より、工夫や改善を考えるのが楽しい" },
  { id: "ap03", factor: "conscientiousness", text: "物事は計画的に、きちんと進めたい" },
  { id: "ap04", factor: "conscientiousness", text: "任されたことは、最後まで丁寧にやり遂げる" },
  { id: "ap05", factor: "extraversion", text: "人と関わったり話したりすることでエネルギーが湧く" },
  { id: "ap06", factor: "extraversion", text: "初対面の人とでも、積極的に関わっていける" },
  { id: "ap07", factor: "agreeableness", text: "自分の主張より、周りとの調和を大切にしたい" },
  { id: "ap08", factor: "agreeableness", text: "困っている人がいると、つい手助けしたくなる" },
  { id: "ap09", factor: "stability", text: "プレッシャーがかかる場面でも、落ち着いて対応できる" },
  { id: "ap10", factor: "stability", text: "失敗や批判があっても、引きずらず切り替えられる" },
];
