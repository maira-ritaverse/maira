/**
 * アプリ内通知(in_app)発火・型定義
 *
 * notifications テーブルは encrypted_payload (text) に
 * lib/crypto/field-encryption.ts の "v{n}:base64url" 形式で
 * JSON 文字列を保存する。受信者ごとに 1 行(同じ暗号文を共有して可)。
 *
 * 注意:
 * - 本ファイルの fire 系関数は service_role を使う(notifications の RLS は
 *   INSERT ポリシーを持たないため。SELECT/UPDATE は本人だけに残してある)。
 *   したがって server 専用。必ず呼び出し側で「誰に何を通知するか」の権限判定を
 *   済ませてから呼ぶこと。本関数自体はテナント境界の判定はしない。
 * - ペイロードに「求職者の内面情報(career_profile の中身、メモ、本人にしか
 *   見えない wants 等)」は決して含めない。同組織アドバイザーが共有してよい
 *   範囲(表示名・進捗ステータス・参照ID・遷移元/先)に限定する。
 */

import { encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";
import { isSubscribed, type NotificationKey, type NotificationPrefs } from "./prefs";

/**
 * 通知ペイロードの kind 文字列。
 * DB の notification_kind enum とは別。enum は「カテゴリ」、こちらは
 * UI 側で表示分岐するための「具体イベント名」。同じ application_followup
 * カテゴリの中で referral_status_change, referral_created, ... が
 * 並ぶ想定。
 */
export type InAppPayload =
  | ReferralStatusChangePayload
  | SeekerJobInterestPayload
  | SeekerApplicationRequestPayload
  | ReferralStatusChangeForSeekerPayload
  | RecommendationLetterFinalizedForSeekerPayload
  | MeetingInvitedPayload
  | MeetingReminderPayload
  | MeetingCanceledPayload
  | LineMessageReceivedPayload
  | LineStaleAlertPayload
  | AdvisorMessageToAgencyPayload
  | AdvisorMessageToSeekerPayload;

export type ReferralStatusChangePayload = {
  kind: "referral_status_change";
  /** UI に出すヘッドライン(例:「面接 → 内定: 山田太郎さん」)。クリック前の一覧表示用。 */
  title: string;
  /** クリック時の遷移先(エージェント側パス)。 */
  href: string;
  referralId: string;
  clientRecordId: string;
  /** 表示用。求職者の内面情報は含めない方針(name のみ)。 */
  clientName: string;
  /** 初回遷移(null)もあり得る。 */
  fromStatus: string | null;
  toStatus: string;
  /** 変更したアドバイザーの表示名。未設定なら null。 */
  actorDisplayName: string | null;
};

export type SeekerJobInterestPayload = {
  kind: "seeker_job_interest";
  /** UI 一覧用見出し(例:「山田太郎さんが △△ 求人に興味あり」)。 */
  title: string;
  /** エージェント側の求人 or クライアント詳細遷移先。 */
  href: string;
  clientRecordId: string;
  clientName: string;
  jobPostingId: string;
  jobLabel: string;
};

export type SeekerApplicationRequestPayload = {
  kind: "seeker_application_request";
  title: string;
  href: string;
  clientRecordId: string;
  clientName: string;
  jobPostingId: string;
  jobLabel: string;
};

/**
 * 求職者本人向け:エージェントが referrals のステータスを更新したことを通知。
 *
 * 求職者の内面情報は載せず、ステータス遷移と求人ラベルのみ。
 * notes(エージェント内部メモ)は絶対に載せない。
 */
export type ReferralStatusChangeForSeekerPayload = {
  kind: "referral_status_change_for_seeker";
  /** UI 見出し(例:「面接 → 内定: 株式会社 X / PdM」) */
  title: string;
  /** 求職者向け遷移先(/app/agent-referrals) */
  href: string;
  referralId: string;
  jobLabel: string;
  fromStatus: string | null;
  toStatus: string;
};

/**
 * 求職者本人向け:推薦文(recommendation_letters)が finalized になったことを通知。
 *
 * 本文(encrypted_body)/件名(encrypted_headline)は機微なので通知ペイロードには
 * 載せず、href の遷移先(/app/recommendation-letters/[id])で復号して見せる。
 */
export type RecommendationLetterFinalizedForSeekerPayload = {
  kind: "recommendation_letter_finalized_for_seeker";
  /** UI 一覧用見出し(例:「推薦文が届きました(株式会社 X / PdM)」)*/
  title: string;
  /** 求職者向け遷移先(/app/recommendation-letters/[id]) */
  href: string;
  recommendationLetterId: string;
  referralId: string;
  jobLabel: string;
  organizationName: string;
};

/**
 * 求職者本人 / エージェントメンバー両方に送りうる「面談予約された」通知。
 * 機密フィールド(agenda)は含めない。求職者にも見える title と URL のみ。
 */
export type MeetingInvitedPayload = {
  kind: "meeting_invited";
  title: string;
  href: string;
  meetingScheduleId: string;
  meetingTitle: string;
  startsAtIso: string;
  joinUrl: string;
  organizationName: string;
};

/** リマインダー(24h/1h 前)時に発火する通知 */
export type MeetingReminderPayload = {
  kind: "meeting_reminder";
  title: string;
  href: string;
  meetingScheduleId: string;
  meetingTitle: string;
  startsAtIso: string;
  joinUrl: string;
  /** どちらのリマインダーか(UI で表示分岐) */
  window: "24h" | "1h";
};

/** 面談がキャンセルされたときの通知 */
export type MeetingCanceledPayload = {
  kind: "meeting_canceled";
  title: string;
  href: string;
  meetingScheduleId: string;
  meetingTitle: string;
  startsAtIso: string;
};

/** 求職者 が advisor チャット に メッセージ を 投稿 → エージェント に 通知 */
export type AdvisorMessageToAgencyPayload = {
  kind: "advisor_message_to_agency";
  title: string;
  href: string;
  threadId: string;
  clientRecordId: string;
  clientName: string;
  preview: string;
};

/** エージェント が advisor チャット に メッセージ を 投稿 → 求職者 に 通知 */
export type AdvisorMessageToSeekerPayload = {
  kind: "advisor_message_to_seeker";
  title: string;
  href: string;
  threadId: string;
  organizationName: string;
  preview: string;
};

/** LINE 公式アカウント に 求職者から 新着 メッセージ が 届いた 時 */
export type LineMessageReceivedPayload = {
  kind: "line_message_received";
  title: string;
  href: string;
  lineUserId: string;
  /** LINE プロフィール 名 */
  senderDisplayName: string | null;
  /** 紐付け 済 なら client_record の 名前 */
  clientName: string | null;
  /** メッセージ プレビュー (短縮済) */
  preview: string;
  messageType: string;
};

/** LINE 会話 が 3 日 以上 連絡 なし の 時 の アラート (担当者 向け) */
export type LineStaleAlertPayload = {
  kind: "line_stale_alert";
  title: string;
  href: string;
  lineUserId: string;
  displayName: string | null;
  clientRecordId: string | null;
  clientName: string | null;
  /** 最後 の 活動 から の 経過 日 数 (整数) */
  daysSinceLastActivity: number;
};

type FireParams = {
  organizationId: string;
  /** 通知を送らないユーザー(変更操作の実行者本人)。 */
  excludeUserId: string;
  payload: InAppPayload;
};

/**
 * 同組織メンバー全員(変更者本人を除く)に in_app 通知を 1 件ずつ INSERT する。
 *
 * 設計判断:
 * - 送信先 N 人分の行を別々に作る(共有テーブルではない)。理由:notifications の
 *   user_id ベース RLS をそのまま使うため。同じ暗号文を共有するので冗長性は
 *   text 数百バイト × N で実用上問題なし。
 * - 暗号化は 1 回(全員同じペイロード)。
 * - 失敗は throw せず console.error にとどめる。呼び出し側は try/catch 不要で
 *   良い設計だが、呼び出し側で更に try/catch する想定の場合に備えて throw しない。
 */
export async function fireInAppNotification(params: FireParams): Promise<void> {
  const service = createServiceClient();

  // 1. 同 org メンバーの user_id + notification_prefs を取得(変更者本人は後段で除外)
  const { data: members, error: membersErr } = await service
    .from("organization_members")
    .select("user_id, notification_prefs")
    .eq("organization_id", params.organizationId)
    // soft delete された メンバー は 通知 対象 外
    .is("removed_at", null);

  if (membersErr) {
    console.error("[notifications] failed to load org members", {
      organizationId: params.organizationId,
      message: membersErr.message,
    });
    return;
  }

  // payload.kind → NotificationKey にマップして購読判定。
  // 1 行 1 マッピング(将来 kind 追加時はここに足す)。
  // null マッピングは prefs 判定をスキップする(常に通知する用途)。
  const KIND_TO_KEY: Record<InAppPayload["kind"], string | null> = {
    referral_status_change: "referral_status_change",
    seeker_job_interest: "seeker_job_interest",
    seeker_application_request: "seeker_application_request",
    // 本人向け通知は org メンバー prefs と無関係なので null
    referral_status_change_for_seeker: null,
    recommendation_letter_finalized_for_seeker: null,
    // 面談関連は組織メンバー全員が見たいケースが多い(代理対応・チーム共有)
    // ただしホスト本人は excludeUserId 経由で外す。prefs gate は当面なし。
    meeting_invited: null,
    meeting_reminder: null,
    meeting_canceled: null,
    // LINE 新着 は 全 org メンバー が 知る べき (担当 分担 で 対応 する 想定)
    line_message_received: null,
    // 3 日 連絡 なし アラート は 担当者 だけ に 送る (呼 出 側 で excludeUserId+単一送信 制御)
    line_stale_alert: null,
    // advisor チャット の 新着 も 全 org メンバー が 知る (担当 分担 で 対応)
    advisor_message_to_agency: null,
    // 求職者 本人 向け は prefs gate 不要
    advisor_message_to_seeker: null,
  };
  const notificationKey = KIND_TO_KEY[params.payload.kind] as NotificationKey | null;

  const recipients = (members ?? [])
    .filter((m) => {
      const uid = m.user_id as string | null;
      if (!uid || uid === params.excludeUserId) return false;
      if (notificationKey) {
        const prefs = (m.notification_prefs as NotificationPrefs | null) ?? null;
        if (!isSubscribed(prefs, notificationKey)) return false;
      }
      return true;
    })
    .map((m) => m.user_id as string);

  if (recipients.length === 0) return;

  // 2. 暗号化(全員に同じ暗号文を配るので 1 回)
  const ciphertext = await encryptField(JSON.stringify(params.payload));
  if (!ciphertext) {
    // encryptField は空文字以外を渡せば必ず非空を返す契約。ここに来たら異常系。
    console.error("[notifications] encryptField returned empty", { kind: params.payload.kind });
    return;
  }

  // 3. 一括 INSERT。kind は notification_kind enum の "application_followup"
  //    (本ペイロードの kind: "referral_status_change" は UI 分岐用、別軸)。
  const now = new Date().toISOString();
  const rows = recipients.map((userId) => ({
    user_id: userId,
    kind: "application_followup" as const,
    channel: "in_app" as const,
    encrypted_payload: ciphertext,
    scheduled_at: now,
    // in_app は配信先がアプリ内なので、書き込み = 配信完了と見なす。
    sent_at: now,
  }));

  const { error: insertErr } = await service.from("notifications").insert(rows);
  if (insertErr) {
    console.error("[notifications] insert failed", {
      organizationId: params.organizationId,
      recipientCount: recipients.length,
      message: insertErr.message,
    });
  }
}

/**
 * 単一ユーザ(求職者本人など)に in-app 通知を 1 件 INSERT する。
 *
 * fireInAppNotification との違い:
 *   ・組織を介さず、特定の user_id 1 人だけに送る
 *   ・purpose:エージェントの操作(referrals 状態変更等)を求職者本人に伝える
 *
 * 通知 prefs は適用しない(本人向けの自分のデータについての通知は常に届ける)。
 * 呼び出し側で「誰に / 何を」の認可は済ませてから呼ぶ責任を持つこと。
 */
export async function fireSeekerNotification(params: {
  userId: string;
  payload: InAppPayload;
}): Promise<void> {
  const service = createServiceClient();

  const ciphertext = await encryptField(JSON.stringify(params.payload));
  if (!ciphertext) {
    console.error("[notifications/seeker] encryptField returned empty", {
      kind: params.payload.kind,
    });
    return;
  }
  const now = new Date().toISOString();
  const { error } = await service.from("notifications").insert({
    user_id: params.userId,
    kind: "application_followup" as const,
    channel: "in_app" as const,
    encrypted_payload: ciphertext,
    scheduled_at: now,
    sent_at: now,
  });
  if (error) {
    console.error("[notifications/seeker] insert failed", {
      userId: params.userId,
      message: error.message,
    });
  }
}
