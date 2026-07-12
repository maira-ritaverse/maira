/**
 * CV(コンバージョン)イベントの発火。
 *
 * 業務システムのステータス遷移(referrals.status 変更、面接完了、内定承諾、入社 等)
 * を Flow 起動用の event_key に翻訳して dispatchFlowTrigger に渡す。
 *
 * ・trigger_type='conversion_event' + trigger_config.event_key 一致の Flow だけ enroll
 * ・LINE 未連携の求職者(line_user_links なし)は無視(サイレント skip)
 * ・エラーは全て握り潰す(業務トランザクションを CV Flow 発火で落とさないため)
 *
 * 呼び出し元:
 *   ・PATCH /api/agency/referrals/[id]  — ステータス遷移時
 *   ・(将来) 面接 status 更新、内定承諾、入社確定、応募 INSERT トリガ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { dispatchFlowTrigger } from "./flow-enroller";

/**
 * referrals.status → CV event key の対応。
 *
 * planned / declined / recommended は「Flow の起動条件」として弱い(既に他手段で
 * 通知しているケースが多い)ので初期実装ではスキップし、以下の 3 状態のみ発火:
 *   ・interview → interview_started
 *   ・offer     → offer_received
 *   ・joined    → onboarded
 *
 * 将来の要望に応じてマッピングを拡張する。null なら発火しない。
 */
export function referralStatusToEventKey(status: string): string | null {
  switch (status) {
    case "interview":
      return "interview_started";
    case "offer":
      return "offer_received";
    case "joined":
      return "onboarded";
    default:
      return null;
  }
}

/**
 * client_record_id から LINE 連携済み line_user_id を引く。
 * 未連携(link 未実施 or ブロック済み)なら null。
 */
async function findLineUserIdForClient(
  admin: SupabaseClient,
  organizationId: string,
  clientRecordId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("line_user_links")
    .select("line_user_id")
    .eq("organization_id", organizationId)
    .eq("client_record_id", clientRecordId)
    .is("unfollowed_at", null)
    .maybeSingle();
  return (data as { line_user_id: string } | null)?.line_user_id ?? null;
}

/**
 * referral のステータス遷移で CV Flow を起動する。
 *
 * ・失敗はログのみで握り潰す(呼び出し元の PATCH レスポンスに影響させない)
 * ・LINE 未連携の求職者はスキップ
 */
export async function fireReferralConversionFlow(params: {
  admin: SupabaseClient;
  organizationId: string;
  clientRecordId: string;
  newStatus: string;
}): Promise<void> {
  const { admin, organizationId, clientRecordId, newStatus } = params;
  try {
    const eventKey = referralStatusToEventKey(newStatus);
    if (!eventKey) return;

    const lineUserId = await findLineUserIdForClient(admin, organizationId, clientRecordId);
    if (!lineUserId) return;

    await dispatchFlowTrigger(admin, organizationId, {
      type: "conversion_event",
      line_user_id: lineUserId,
      event_key: eventKey,
      occurred_at: new Date(),
    });
  } catch (err) {
    console.error("[cv-flow] fireReferralConversionFlow failed", {
      organizationId,
      clientRecordId,
      newStatus,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
