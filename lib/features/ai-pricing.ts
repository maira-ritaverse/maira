/**
 * AI 利用の「ざっくり推定コスト」算出ヘルパ。
 *
 * 目的:
 *   - 運営者が「月の AI コストがおおよそいくらか」を即視できる
 *   - 厳密な原価計算ではなく、桁感の把握 + 予算超過の早期警告
 *
 * 算出方法:
 *   kind 別の「1 回あたりの平均見積コスト(円)」× 回数
 *
 * 単価の根拠(2026-06 時点):
 *   - photo_enhance         : OpenAI gpt-image-1 standard 1024x1024 ≒ $0.04 / image
 *   - job_recommendation_*  : Claude Sonnet 4.6, 平均 input 2k + output 500 token
 *                             = $3/1M × 2k + $15/1M × 500 ≒ $0.0135 / call
 *   USD→JPY は 150 で固定。為替変動を厳密に追わない MVP 前提。
 *
 * 単価の更新:
 *   モデルや為替が大きく変わったら COST_PER_CALL_JPY と USD_TO_JPY を更新する。
 *   テストでカバーするより「運営者が一目で違和感を持てる」運用を優先する。
 */

export const USD_TO_JPY = 150;

/** kind 別 1 回あたりの推定コスト(円、小数 2 位まで) */
export const COST_PER_CALL_JPY: Record<string, number> = {
  photo_enhance: round2(0.04 * USD_TO_JPY),
  job_recommendation_seeker: round2(0.0135 * USD_TO_JPY),
  job_recommendation_agency: round2(0.0135 * USD_TO_JPY),
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 推定月次コスト(円)を返す。未知 kind は 0 円扱い。 */
export function estimateCostJpy(kind: string, count: number): number {
  const unit = COST_PER_CALL_JPY[kind] ?? 0;
  return round2(unit * count);
}

/**
 * byKind マップから合計推定コストを返す。
 * { photo_enhance: 30, job_recommendation_seeker: 100 } → 円合計
 */
export function sumEstimatedCost(byKind: Record<string, number>): number {
  let total = 0;
  for (const [kind, count] of Object.entries(byKind)) {
    total += estimateCostJpy(kind, count);
  }
  return round2(total);
}

/** 表示用フォーマッタ(¥1,234 / ¥1,234.56 など) */
export function formatJpy(n: number): string {
  if (!Number.isFinite(n)) return "—";
  // 小数があれば 2 位まで、なければ整数
  const isInt = Math.round(n) === n;
  return `¥${n.toLocaleString("ja-JP", {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
