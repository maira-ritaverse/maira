/**
 * 成約率(F セクション)の色しきい値。
 *
 * placement-rate-section.tsx の半円ゲージと、将来の関連 UI(advisor 別 KPI 等)で
 * 同じ色基準を使うために集約。spec 通り 3 段階:
 *   0-30 %  → 赤(改善余地大)
 *   31-60 % → 黄(伸びしろあり)
 *   61-100% → 緑(良好)
 *
 * dark mode でも視認性が落ちないよう、コントラストの強い Tailwind 標準色を採用。
 * しきい値を変える場合は spec と合わせて変更し、tests も同時に更新する。
 */

export const PLACEMENT_RATE_COLOR_RED = "#ef4444"; // tailwind red-500
export const PLACEMENT_RATE_COLOR_AMBER = "#f59e0b"; // tailwind amber-500
export const PLACEMENT_RATE_COLOR_GREEN = "#10b981"; // tailwind emerald-500

/**
 * 成約率(0〜100 の数値)から表示色を返す純関数。
 *
 * - 0〜30  → 赤
 * - 31〜60 → 黄
 * - 61〜100 → 緑
 *
 * 100 超の入力は呼び出し側でクランプ済みの想定だが、本関数は緑にフォールバック
 * する(threshold で「以下」判定のため自動で緑に倒れる)。
 * 負の値は赤に倒れる(rate <= 30 の判定で素直に拾える)。
 */
export function colorForPlacementRate(rate: number): string {
  if (rate <= 30) return PLACEMENT_RATE_COLOR_RED;
  if (rate <= 60) return PLACEMENT_RATE_COLOR_AMBER;
  return PLACEMENT_RATE_COLOR_GREEN;
}
