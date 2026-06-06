// 軸タイプ × 適性因子 → 職種カテゴリのマッピング。
//
// ⚠️ これは暫定版(v0)。厚労省職業分類を参考にした、軸タイプ→職種カテゴリの対応。
// 将来、専門家レビューと検証で磨く前提のデータ。
//
// 設計上のポイント:
// - AIに職種を「捏造」させない。提示する職種は必ずこの固定マッピングから選ぶ。
//   AIが生成するのは「なぜその職種が向くか」の説明文のみ。
// - 提示は「向いている方向の候補」として行い、断定しない。

import type { AxisType } from "./axis-questions";
import type { AptitudeFactor } from "./aptitude-questions";

export type JobCategory = {
  name: string; // 職種カテゴリ名
  description: string; // 簡単な説明(結果画面でカードに添えるための一行)
};

// 軸タイプ → 向いている職種カテゴリ(厚労省分類を参考)。
// 同じ軸でも、適性因子の組み合わせで実際にフィットする職種は変わるため、
// ここではあくまで「方向の候補」として 2〜3 個ずつ列挙する。
export const axisToJobs: Record<AxisType, JobCategory[]> = {
  specialist: [
    { name: "研究・技術職", description: "専門分野を深く追求する" },
    { name: "エンジニア(ソフトウェア開発)", description: "技術を極める" },
    { name: "専門職(医療技術・士業など)", description: "資格・専門性を活かす" },
  ],
  management: [
    { name: "管理職・マネジメント", description: "組織やチームを率いる" },
    { name: "経営企画・事業管理", description: "全体を見て意思決定する" },
    { name: "コンサルタント", description: "課題解決を導く" },
  ],
  autonomy: [
    { name: "デザイナー・クリエイティブ職", description: "自分の裁量で表現する" },
    { name: "編集・ライター", description: "自分のペースで進める" },
    { name: "裁量の大きい企画・営業", description: "自由度の高い働き方" },
  ],
  security: [
    { name: "一般事務・総務・人事", description: "安定した環境で支える" },
    { name: "経理・財務", description: "堅実で専門性のある定型業務" },
    { name: "公務・団体職員系", description: "長期安定の環境" },
  ],
  entrepreneur: [
    { name: "新規事業開発・企画", description: "新しいものを生み出す" },
    { name: "マーケティング・プロデュース", description: "事業を作り広げる" },
    { name: "スタートアップ系職種", description: "ゼロイチに挑む" },
  ],
  service: [
    { name: "福祉・介護", description: "人を直接支える" },
    { name: "医療・看護・保健", description: "人の健康に貢献する" },
    { name: "保育・教育", description: "人の成長を支える" },
  ],
  challenge: [
    { name: "営業(新規開拓)", description: "高い目標に挑む" },
    { name: "コンサルタント", description: "難題を解決する" },
    { name: "金融・投資のフロント", description: "競争の中で成果を出す" },
  ],
  lifestyle: [
    { name: "勤務時間が安定した事務・管理職", description: "両立しやすい" },
    { name: "リモート可能な専門職", description: "柔軟な働き方" },
  ],
};

// 適性因子による補足ヒント。同じ軸でも、強みによって向く職種は変わるため、
// 結果説明の文生成(AI)時に「なぜこの職種か」の根拠として渡す想定。
export const aptitudeJobHints: Record<AptitudeFactor, string> = {
  openness: "新しい分野や変化のある環境で力を発揮しやすい",
  conscientiousness: "正確さや継続性が求められる仕事で信頼される",
  extraversion: "人と関わる仕事、対人接点の多い職種で活きる",
  agreeableness: "チームでの協働やサポート役で力を発揮する",
  stability: "プレッシャーのある場面でも安定して対応できる",
};
