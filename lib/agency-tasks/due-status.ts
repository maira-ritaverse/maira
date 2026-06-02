/**
 * タスクの期限状態を判定する純関数とその閾値。
 *
 * クライアント側で現在時刻(useNow)と比較して呼ぶ。
 * サーバ側で固定値を埋めると、ページが古くなるにつれ判定がズレるため、
 * 表示時点で評価する。
 *
 * クライアント詳細(タスクの色分け)と、クライアント一覧(期限超過バッジ)の
 * 両方から再利用するため、ここに集約している。
 */

// 「期限間近」とみなす残り時間(時間単位)。指示書は 48h 目安。
export const SOON_THRESHOLD_HOURS = 48;

export type DueStatus = "completed" | "overdue" | "soon" | "normal" | "none";

/**
 * タスクの期限状態を判定する。
 *
 * @param dueAt   タスクの期限(ISO 文字列 or null)
 * @param now     比較に使う現在時刻(useNow で取得。マウント前は null)
 * @param isDone  完了済みかどうか
 *
 * - isDone: 完了は色を主張させない("completed" = 薄く表示)
 * - now が null(マウント前): "normal" を返し、ハイドレーション後に再評価
 * - 期限なし: "none"(色なし)
 * - now > dueAt: "overdue"
 * - now <= dueAt < now + 48h: "soon"
 * - それより先: "normal"
 */
export function getDueStatus(dueAt: string | null, now: Date | null, isDone: boolean): DueStatus {
  if (isDone) return "completed";
  if (!now) return "normal";
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  const t = now.getTime();
  if (due < t) return "overdue";
  const soonCutoff = t + SOON_THRESHOLD_HOURS * 60 * 60 * 1000;
  if (due < soonCutoff) return "soon";
  return "normal";
}
