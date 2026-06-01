// 診断1(キャリアの軸):キャリアアンカー8タイプを判定するための設問データ。
// 各タイプ2問、計16問。回答は4段階(4: とても当てはまる 〜 1: 当てはまらない)。
// なぜ4段階かというと、中央値(「どちらでもない」)を含む奇数段階だと
// 判断を保留する回答に寄りすぎ、タイプ間の差が出にくくなるため。
// ※今回の実装では UI 側で中央値を許容するか別途検討するが、ここではデータ定義のみ。

export type AxisType =
  | "specialist" // 専門・職能別能力
  | "management" // 経営管理能力
  | "autonomy" // 自律・独立
  | "security" // 保障・安定
  | "entrepreneur" // 起業家的創造性
  | "service" // 奉仕・社会貢献
  | "challenge" // 純粋な挑戦
  | "lifestyle"; // 生活様式

export type AxisQuestion = {
  id: string;
  text: string;
  type: AxisType; // この設問がどのタイプを測るか
};

// 結果表示・職種マッピング側で参照する、タイプの日本語ラベル。
// ユーザーには「専門性を極める」のように、行動レベルで分かる表現で見せる。
export const axisTypeLabels: Record<AxisType, string> = {
  specialist: "専門性を極める",
  management: "組織を動かす",
  autonomy: "自律・自由",
  security: "安定・安心",
  entrepreneur: "創造・事業づくり",
  service: "貢献・人の役に立つ",
  challenge: "挑戦・達成",
  lifestyle: "ワークライフバランス",
};

export const axisQuestions: AxisQuestion[] = [
  { id: "ax01", type: "specialist", text: "仕事では、広く色々やるより、一つの分野を深く極めたい" },
  { id: "ax02", type: "specialist", text: "「その道のプロ」と呼ばれることに憧れる" },
  { id: "ax03", type: "management", text: "人やチームをまとめ、引っ張る役割にやりがいを感じる" },
  { id: "ax04", type: "management", text: "いずれは責任ある立場で、大きな決定をしたい" },
  { id: "ax05", type: "autonomy", text: "細かく管理されるより、自分のやり方・ペースで進めたい" },
  { id: "ax06", type: "autonomy", text: "組織のルールに縛られるのは、できれば避けたい" },
  { id: "ax07", type: "security", text: "変化や冒険より、安定して長く働ける環境が安心する" },
  { id: "ax08", type: "security", text: "収入や雇用が予測できることを重視する" },
  { id: "ax09", type: "entrepreneur", text: "既存のものより、自分で新しい何かを生み出したい" },
  { id: "ax10", type: "entrepreneur", text: "ゼロから事業やサービスを作ることにわくわくする" },
  { id: "ax11", type: "service", text: "お金や地位より、誰かの役に立つ実感を大事にしたい" },
  { id: "ax12", type: "service", text: "社会や人の課題を解決する仕事に意義を感じる" },
  { id: "ax13", type: "challenge", text: "簡単な仕事より、難しい課題に挑むほうが燃える" },
  { id: "ax14", type: "challenge", text: "乗り越えられそうにない壁ほど、挑戦したくなる" },
  { id: "ax15", type: "lifestyle", text: "仕事も大事だが、私生活との両立が何より大切" },
  { id: "ax16", type: "lifestyle", text: "働き方を、自分の生活に合わせて調整したい" },
];
