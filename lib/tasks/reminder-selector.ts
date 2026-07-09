/**
 * タスク リマインド の 対象 選定 ロジック。
 *
 * 副 作用 なし の 純粋 関数 として 実装 し、 テスト を 書き やすく する。
 * 実 際 の DB / LINE 通信 は cron ルート (app/api/internal/tasks/reminders) が
 * 担当。
 */

export type TaskCandidate = {
  id: string;
  dueAt: string; // ISO 8601
  status: string;
  remindedAt: string | null;
};

/**
 * 「今 リマインド すべき タスク」 を 判定 する。
 *
 * 条件:
 *   ・status = 'pending' (完了 済 は 対象 外)
 *   ・remindedAt が null (既に 送信 済 は スキップ)
 *   ・windowStart <= dueAt <= windowEnd
 *
 * 「1 日 前」 と 「1 時間 前」 の 2 段階 で 呼び 分ける 想定 だが、 この 関数 は
 * window の 判定 のみ 行い、 呼び 分け は cron ルート 側 で 実行 する。
 */
export function selectDueTasks<T extends TaskCandidate>(
  tasks: T[],
  window: { start: Date; end: Date },
): T[] {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  return tasks.filter((t) => {
    if (t.status !== "pending") return false;
    if (t.remindedAt !== null) return false;
    const dueMs = Date.parse(t.dueAt);
    if (Number.isNaN(dueMs)) return false;
    return dueMs >= startMs && dueMs <= endMs;
  });
}

/**
 * リマインド 本文 の 整形。 タイトル + 期限 の JST 表示 で 短く。
 */
export function buildReminderText(taskTitle: string, dueAtIso: string): string {
  const d = new Date(dueAtIso);
  const dateStr = d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  return `【期限 リマインド】\n${taskTitle}\n期限: ${dateStr}`;
}
