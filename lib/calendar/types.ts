/**
 * カレンダーイベント型定義
 *
 * agency カレンダー画面で月 / 週グリッドに並べる「日付ベースのイベント」。
 * ソースは複数(client_records / agency_tasks / client_interactions)で、
 * ここでは統一的な CalendarEvent[] にまとめてから描画する。
 */

export type CalendarEventKind =
  | "first_meeting" // クライアントの初回面談予定 (client_records.first_meeting_date)
  | "intake" // 受付日(client_records.intake_date) — 過去になりがちだが集計用に
  | "task_due" // agency_tasks.due_at(未完了タスクの期限)
  | "interaction" // client_interactions.occurred_at(対応履歴)
  | "meeting" // meeting_schedules.starts_at(Maira 内で予約した Zoom/Meet 面談)
  | "external_google"; // Google Calendar から取り込んだ予定(本人接続の Primary)

export type CalendarEvent = {
  /** React の key 用に kind + 元 id を連結 */
  id: string;
  kind: CalendarEventKind;
  /** YYYY-MM-DD 形式の日付(タイムゾーン依存はしない)。occurred_at は時刻部分を切り落とす */
  dateKey: string;
  /** イベントの ISO 文字列(時刻が意味を持つ task_due / interaction で使う) */
  occurredAt: string | null;
  title: string;
  /** 詳細ページへの遷移用(Google 由来は null) */
  clientRecordId: string | null;
  /** 詳細ページへの直接リンクラベル(Google 由来は organizer の表示名) */
  clientName: string;
  /** meeting/external_google でのみ使う任意フィールド */
  meetingScheduleId?: string;
  joinUrl?: string;
  /** Google 由来のときの event.id(編集 / 削除に使う) */
  externalEventId?: string;
  /** 終了時刻(時間枠表示用、ISO) */
  endsAt?: string;
};
