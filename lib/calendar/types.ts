/**
 * カレンダーイベント型定義
 *
 * agency カレンダー画面で月 / 週グリッドに並べる「日付ベースのイベント」。
 * ソースは複数(client_records / agency_tasks / client_interactions)で、
 * ここでは統一的な CalendarEvent[] にまとめてから描画する。
 */

export type CalendarEventKind =
  | "first_meeting" // クライアント の 初回 面談 予定 (client_records.first_meeting_date)
  | "intake" // 受付 日 (client_records.intake_date) — 過去 に なりがち だが 集計 用 に
  | "task_due" // agency_tasks.due_at (未完了 タスク の 期限)
  | "interaction" // client_interactions.occurred_at (対応 履歴)
  | "meeting" // meeting_schedules.starts_at (Maira 内 で 予約 した Zoom/Meet 面談)
  | "meeting_tentative" // line_meeting_proposals.candidates (LINE で 提案 中 の 未 確定 スロット)
  | "company_interview" // referrals.scheduled_interview_at (企業 と の 面接 予定、 直近 1 件 デノーマライズ)
  | "interview_round" // interviews.scheduled_at (1 応募 × N 回 の 個別 面接 ラウンド)
  | "external_google"; // Google Calendar から 取り込んだ 予定 (本人 接続 の Primary)

/**
 * interview_round の サブ 種別 (1 次 / 2 次 / 最終 / 内定 面談 / 企業 面談)。
 * 表示 上 の ラベル に 使う (「1 次」 「最終」 等 の チップ 表示)。
 */
export type InterviewRoundLabel = "1次" | "2次" | "最終" | "内定" | "企業";

export type CalendarEvent = {
  /** React の key 用 に kind + 元 id を 連結 */
  id: string;
  kind: CalendarEventKind;
  /** YYYY-MM-DD 形式 の 日付。 occurred_at は 時刻 部分 を 切り 落とす */
  dateKey: string;
  /** イベント の ISO 文字列 (時刻 が 意味 を 持つ task_due / interaction / company_interview で 使う) */
  occurredAt: string | null;
  title: string;
  /** 詳細 ページ へ の 遷移 用 (Google 由来 は null) */
  clientRecordId: string | null;
  /** 詳細 ページ へ の 直接 リンク ラベル (Google 由来 は organizer の 表示 名) */
  clientName: string;
  /** meeting / external_google で のみ 使う 任意 フィールド */
  meetingScheduleId?: string;
  joinUrl?: string;
  /** Google 由来 の 場合 の event.id (編集 / 削除 に 使う) */
  externalEventId?: string;
  /** 終了 時刻 (時間 枠 表示 用、 ISO) */
  endsAt?: string;
  /** company_interview で 使う: 企業 名 + ポジション */
  companyName?: string;
  jobPosition?: string;
  /** company_interview で 使う: 面接 の 補足 メモ (「1 次 対面」 「オンライン」 等) */
  interviewNote?: string;
  /**
   * meeting kind で 使う: 会議 録音 の 状態。 M5 の 「録音 ワンクリック」 UI で 使用。
   *   - "planned"  : 録音 予定 フラグ が 立っている が まだ アップロード されて いない
   *   - "recorded" : career_intake_recordings に アップロード 済 (recording_id あり)
   *   - null       : 録音 予定 も アップロード も 無い
   */
  recordingState?: "planned" | "recorded" | null;
  /** 録音 済 の 場合 の career_intake_recordings.id。 clients/[id] 詳細 へ の 導線 に 使う */
  recordingId?: string | null;
  /** interview_round で 使う: ラウンド の 表示 ラベル (1 次 / 2 次 / 最終 / 内定 / 企業) */
  roundLabel?: InterviewRoundLabel;
  /**
   * meeting_tentative で 使う: 対応 する line_meeting_proposals.id。
   * クリック 時 に proposal 詳細 に 飛ばす 導線 用。
   */
  proposalId?: string;
  /** meeting_tentative で 使う: candidates jsonb 配列 内 の slot index (0-based) */
  proposalSlotIndex?: number;
};
