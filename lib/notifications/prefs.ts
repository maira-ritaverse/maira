/**
 * 通知購読設定(個人 × 組織別)
 *
 * organization_members.notification_prefs(jsonb)に保存される設定を
 * 型として扱う + デフォルト適用の純関数を提供する。
 *
 * 値の運用:
 *   - 未指定 / 空オブジェクト → 全て購読する(オプトアウト方式)
 *   - 明示的に false → そのキーだけ抑制
 *
 * チャネル:
 *   - 各 通知 種類 (NotificationKey) ON/OFF は in-app + メール 両方 に 効く
 *   - メール 全体 マスター: email_enabled (false で 全 通知 メール 停止)
 *   - 招待 / パスワード リセット / 面談 招待 等 の トランザクション メール は 対象 外
 */
import { z } from "zod";

/** 通知の種類(将来追加するキーをここで管理) */
export type NotificationKey =
  | "referral_status_change" // 応募ステータス変化
  | "seeker_job_interest" // 求職者が AI 推薦から「興味あり」を表明した
  | "seeker_application_request" // 求職者が「応募を依頼」した
  | "task_assigned" // タスクが自分にアサインされた(将来用)
  | "client_silent_30d" // 30日沈黙顧客の日次サマリ(将来用)
  | "line_message_received" // 公式 LINE で 求職者 から メッセージ が 届いた
  | "daily_digest"; // 毎朝 の ダイジェスト メール (タスク + 沈黙 顧客 + 停止 中 応募)

export type NotificationPrefs = Partial<Record<NotificationKey, boolean>> & {
  /** メール 通知 全体 の マスター スイッチ。 未指定 / true = 送る、 false = 一切 送らない */
  email_enabled?: boolean;
};

export const notificationPrefsSchema = z.object({
  referral_status_change: z.boolean().optional(),
  seeker_job_interest: z.boolean().optional(),
  seeker_application_request: z.boolean().optional(),
  task_assigned: z.boolean().optional(),
  client_silent_30d: z.boolean().optional(),
  line_message_received: z.boolean().optional(),
  daily_digest: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
});

/** UI に 表示 する 通知 種類 の 順序 (UI も これ に 従う) */
export const NOTIFICATION_DISPLAY_ORDER: NotificationKey[] = [
  "daily_digest",
  "line_message_received",
  "seeker_job_interest",
  "seeker_application_request",
  "referral_status_change",
  "task_assigned",
  "client_silent_30d",
];

/** 通知ラベル(UI 表示用) */
export const NOTIFICATION_LABEL: Record<NotificationKey, string> = {
  referral_status_change: "応募ステータスの変化",
  seeker_job_interest: "求職者からの「興味あり」表明",
  seeker_application_request: "求職者からの「応募を依頼」",
  task_assigned: "タスクの割り当て",
  client_silent_30d: "30 日以上対応していない顧客のサマリ",
  line_message_received: "公式 LINE での 新規 メッセージ",
  daily_digest: "毎朝 の ダイジェスト メール",
};

/** 通知の説明(UI のヘルプテキスト) */
export const NOTIFICATION_DESCRIPTION: Record<NotificationKey, string> = {
  referral_status_change: "他のメンバーが応募の選考状況を変更した時に通知する",
  seeker_job_interest: "自社の求人に対して、求職者が「興味あり」を表明した時に通知する",
  seeker_application_request: "自社の求人に対して、求職者が「応募を依頼」した時に通知する",
  task_assigned: "(未実装)担当タスクが新しく自分に割り当てられた時に通知する",
  client_silent_30d:
    "(daily_digest に 統合 済) 沈黙 顧客 件数 は 朝の ダイジェスト で 配信 中。 個別 通知 を 出す 場合 の キー として 保持。",
  line_message_received: "求職者 から 公式 LINE 経由 で メッセージ が 届いた 時 に 通知 する",
  daily_digest:
    "毎朝 8 時 に 今日 期限 / 超過 の タスク・ 沈黙 中 の 顧客・ 進捗 停止 中 の 応募 を 1 通 に まとめて 配信 (admin のみ、 メール 専用)",
};

/**
 * prefs に対して「key を購読する?」を判定する純関数。
 * 未指定 / 空オブジェクトは true(全 ON)、明示 false のみ抑制。
 *
 * メール 送信 で 使う 場合 は 必ず isEmailEnabled と AND で 評価 する こと
 * (= マスター が OFF なら 種類 別 が ON でも 送らない)。
 */
export function isSubscribed(prefs: NotificationPrefs | null, key: NotificationKey): boolean {
  if (!prefs) return true;
  const v = prefs[key];
  if (v === false) return false;
  return true;
}

/**
 * メール 通知 全体 マスター が ON か?
 * 未指定 / true = ON、 false の 時 だけ OFF。
 * トランザクション メール (招待 / パスワード リセット / 面談 招待 等) は
 * この フラグ の 対象 外 (= ユーザー が OFF にして いても 送る)。
 */
export function isEmailEnabled(prefs: NotificationPrefs | null): boolean {
  if (!prefs) return true;
  return prefs.email_enabled !== false;
}
