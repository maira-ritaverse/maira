/**
 * 通知購読設定(個人 × 組織別)
 *
 * organization_members.notification_prefs(jsonb)に保存される設定を
 * 型として扱う + デフォルト適用の純関数を提供する。
 *
 * 値の運用:
 *   - 未指定 / 空オブジェクト → 全て購読する(オプトアウト方式)
 *   - 明示的に false → そのキーだけ抑制
 */
import { z } from "zod";

/** 通知の種類(将来追加するキーをここで管理) */
export type NotificationKey =
  | "referral_status_change" // 応募ステータス変化
  | "seeker_job_interest" // 求職者が AI 推薦から「興味あり」を表明した
  | "seeker_application_request" // 求職者が「応募を依頼」した
  | "task_assigned" // タスクが自分にアサインされた(将来用)
  | "client_silent_30d"; // 30日沈黙顧客の日次サマリ(将来用)

export type NotificationPrefs = Partial<Record<NotificationKey, boolean>>;

export const notificationPrefsSchema = z.object({
  referral_status_change: z.boolean().optional(),
  seeker_job_interest: z.boolean().optional(),
  seeker_application_request: z.boolean().optional(),
  task_assigned: z.boolean().optional(),
  client_silent_30d: z.boolean().optional(),
});

/** 通知ラベル(UI 表示用) */
export const NOTIFICATION_LABEL: Record<NotificationKey, string> = {
  referral_status_change: "応募ステータスの変化",
  seeker_job_interest: "求職者からの「興味あり」表明",
  seeker_application_request: "求職者からの「応募を依頼」",
  task_assigned: "タスクの割り当て",
  client_silent_30d: "30 日以上対応していない顧客のサマリ",
};

/** 通知の説明(UI のヘルプテキスト) */
export const NOTIFICATION_DESCRIPTION: Record<NotificationKey, string> = {
  referral_status_change: "他のメンバーが応募の選考状況を変更した時に通知する",
  seeker_job_interest: "自社の求人に対して、求職者が「興味あり」を表明した時に通知する",
  seeker_application_request: "自社の求人に対して、求職者が「応募を依頼」した時に通知する",
  task_assigned: "(未実装)担当タスクが新しく自分に割り当てられた時に通知する",
  client_silent_30d: "(未実装)毎朝、対応が止まっている顧客の件数を通知する",
};

/**
 * prefs に対して「key を購読する?」を判定する純関数。
 * 未指定 / 空オブジェクトは true(全 ON)、明示 false のみ抑制。
 */
export function isSubscribed(prefs: NotificationPrefs | null, key: NotificationKey): boolean {
  if (!prefs) return true;
  const v = prefs[key];
  if (v === false) return false;
  return true;
}
