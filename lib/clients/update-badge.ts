/**
 * 新着・更新バッジ(案B:メンバー個人単位)の判定ロジック。
 *
 * 一覧クエリ側で本人データ(career_profile / resumes / cvs)の更新時刻と
 * 閲覧メンバーの最終閲覧時刻を集約してから、最後にこの関数で boolean に倒す。
 *
 * IO を持たない純粋関数として切り出すのは、判定ロジックの単体テスト容易性と、
 * 一覧クエリ本体(I/O 集約)の責務を分離したいため。
 *
 * 文字列比較について:
 *   どちらも timestamptz を toISOString() 経由で ISO 8601 にした文字列を想定。
 *   ISO 8601(YYYY-MM-DDTHH:MM:SS.sssZ)は辞書順比較が時刻順と一致するため、
 *   new Date() でパースせず文字列の > で比較してよい(余計なアロケーション回避)。
 */

/**
 * 「自分の最終閲覧時刻」より「本人データの最新更新時刻」が新しいかを判定する。
 *
 * @param latestUpdatedAt 本人データ(profile/resume/cv)の最新更新 ISO 文字列。本人データなし → null
 * @param lastViewedAt 自分(閲覧メンバー)の最終閲覧 ISO 文字列。未閲覧 → null
 * @returns 新着バッジを表示すべきなら true
 *
 * 判定ルール:
 *   - 本人データが無い(latestUpdatedAt = null)→ 新着にしない(出すものが無い)
 *   - 本人データはあるが未閲覧(lastViewedAt = null)→ 新着(初回認知させる)
 *   - 両方ある → 最新更新 > 最終閲覧 なら新着
 *
 * 「同時刻」(latestUpdatedAt === lastViewedAt)は新着にしない(>= ではなく >)。
 * 同時刻が現実に起きる確率は低いが、ISO ミリ秒精度で起きた場合は閲覧側を優先して
 * 「もう見た」とみなす方が UX として落ち着く(常時新着が出続ける挙動を避ける)。
 */
export function computeHasUnreadUpdate(
  latestUpdatedAt: string | null,
  lastViewedAt: string | null,
): boolean {
  if (latestUpdatedAt === null) return false;
  if (lastViewedAt === null) return true;
  return latestUpdatedAt > lastViewedAt;
}

/**
 * 複数の ISO 8601 文字列の最大値(= 一番新しい時刻)を返すヘルパー。
 *
 * null は無視。すべて null なら null を返す。
 * 一覧クエリで「resume 群の最新」「cv 群の最新」「profile」を 1 つに畳むのに使う。
 *
 * Math.max のように reduce で書けるが、ISO 文字列の辞書順比較を活用するため
 * 明示的な比較ループにする(undefined / null の扱いも安全に)。
 */
export function maxIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let max: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (max === null || v > max) {
      max = v;
    }
  }
  return max;
}
