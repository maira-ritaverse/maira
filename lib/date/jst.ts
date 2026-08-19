/**
 * 日本時間(Asia/Tokyo)の暦日ユーティリティ
 *
 * なぜ必要か:
 *   `new Date().toISOString().slice(0, 10)` は UTC の日付を返すため、日本時間の
 *   00:00〜08:59 の間は「前日」の日付になってしまう。サーバー(Vercel=UTC)でも
 *   ブラウザ(JP ユーザーのローカル=JST でも toISOString で UTC 変換される)でも
 *   同じズレが起きる。履歴書 / 職務経歴書 / 推薦状の作成日や受付日など、日本の
 *   「今日」を YYYY-MM-DD で入れたい箇所ではこのヘルパーを使う。
 *
 *   Intl.DateTimeFormat の en-CA ロケール + timeZone: "Asia/Tokyo" は
 *   "YYYY-MM-DD" 形式を返すため、UTC 変換を挟まず JST 暦日を得られる。
 */
export function todayInJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
