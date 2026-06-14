/**
 * マーケティング画面の全体 KPI 計算(純関数)。
 *
 * scenario-list.tsx の上部に出している「直近 30 日 成功 / 失敗 / スキップ / 配信率」を、
 * テスト可能な純関数に切り出した。シナリオ別 stats(sendStatsByScenarioId)を入力に取る。
 *
 * 設計方針:
 *   - skipped は「対象 0 件・未設定で送らなかった」ものを含むため、配信率の分母には入れない
 *     (deliveryRate = sent / (sent + failed))
 *   - 分母が 0 のときは null を返す(UI で「—」として「データなし」を明示)
 *   - パーセントは Math.round で四捨五入の整数(0〜100)
 */

export type ScenarioSendStatsMap = Record<
  string,
  { sent: number; failed: number; skipped: number }
>;

export type OverallSendStats = {
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * シナリオ別 stats を合計して全体集計を返す。
 *
 * 空 Map(配信履歴ゼロ)なら {sent:0, failed:0, skipped:0}。
 * Object.values + reduce を使うが、純関数として副作用なし。
 */
export function aggregateOverallSendStats(statsByScenario: ScenarioSendStatsMap): OverallSendStats {
  return Object.values(statsByScenario).reduce<OverallSendStats>(
    (acc, s) => ({
      sent: acc.sent + s.sent,
      failed: acc.failed + s.failed,
      skipped: acc.skipped + s.skipped,
    }),
    { sent: 0, failed: 0, skipped: 0 },
  );
}

/**
 * 配信率(%)を計算する。skipped は分母に含めない。
 *
 * - sent + failed === 0 → null(データなし、UI で "—" 表示)
 * - それ以外 → 0〜100 の整数(Math.round)
 */
export function calculateDeliveryRate(stats: OverallSendStats): number | null {
  const attempted = stats.sent + stats.failed;
  if (attempted === 0) return null;
  return Math.round((stats.sent / attempted) * 100);
}
