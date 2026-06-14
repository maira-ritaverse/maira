/**
 * シナリオ判定ロジック(Phase C-3 MVP では 2 シナリオ)
 *
 *   register_meeting_promotion: 求職者が登録されてから N 日経過したが、
 *                               まだ一度も対応履歴(client_interactions)が無いケース
 *   dormant_outreach:           最新の対応履歴から N 日以上経過したケース(再アプローチ)
 *
 * 残り 5 シナリオは interviews / job_wants / candidate_birthdays が無いため
 * 現状の DB スキーマでは判定不能 → IMPLEMENTED_SCENARIO_KEYS から外して
 * UI で「準備中」バッジを出している(Turn 1 で対応済み)。
 *
 * 設計方針:
 *   - 全クエリは service_role キー(RLS bypass)で実行する想定
 *   - 同一 client × 同一 scenario への重複送信を防ぐため、
 *     ma_send_logs に status='sent' の行があるかチェックする
 *   - 「未登録メアド」「クローズ済みステータス」は呼び出し側で除外しない
 *     → 判定クエリで弾く(declined / completed のステータスは送らない)
 */

// 型は Edge Function 内で完結させる(Web 側の型を import すると Maira 全体のビルドが必要になる)
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * 配信候補 1 件の情報。index.ts で変数展開してから送信する。
 */
export type CandidateRow = {
  clientRecordId: string;
  clientName: string;
  clientEmail: string;
  assignedMemberId: string | null;
  // 担当アドバイザーの名前・メールは organization_members + auth.users から
  // index.ts 側で別途引く(Edge Function ハンドラ内で join するより明示的)
};

/**
 * register_meeting_promotion:
 *   client_records.created_at <= now() - INTERVAL '{days} days'
 *   AND status NOT IN ('completed', 'declined')   -- 既にクローズ済みは除外
 *   AND email_distribution_enabled = true         -- 配信抑制フラグを尊重
 *   AND まだ一度も client_interactions が記録されていない
 *   AND まだこのシナリオで送信済みでない
 */
export async function findRegisterMeetingPromotionCandidates(
  supabase: SupabaseClient,
  params: { organizationId: string; scenarioId: string; days: number },
): Promise<CandidateRow[]> {
  const cutoff = new Date(Date.now() - params.days * 86400 * 1000).toISOString();

  // 1) created_at が cutoff より古い + ステータスがクローズ済みでない求職者
  //    かつ email_distribution_enabled = true(求職者が配信停止フラグを立てていない)
  const { data: clients, error: cErr } = await supabase
    .from("client_records")
    .select("id, name, email, assigned_member_id, status, created_at")
    .eq("organization_id", params.organizationId)
    .eq("email_distribution_enabled", true)
    .lte("created_at", cutoff)
    .not("status", "in", "(completed,declined)");
  if (cErr) throw new Error(`client_records 取得失敗: ${cErr.message}`);
  if (!clients || clients.length === 0) return [];

  const clientIds = clients.map((c) => c.id);

  // 2) これらのうち、interactions が 1 件でもある求職者を除外
  const { data: hasInteractions, error: iErr } = await supabase
    .from("client_interactions")
    .select("client_record_id")
    .in("client_record_id", clientIds);
  if (iErr) throw new Error(`client_interactions 取得失敗: ${iErr.message}`);
  const interactedSet = new Set((hasInteractions ?? []).map((r) => r.client_record_id));

  // 3) このシナリオで既に送信済み(status='sent')の求職者を除外
  const { data: sentLogs, error: lErr } = await supabase
    .from("ma_send_logs")
    .select("recipient_client_record_id")
    .eq("scenario_id", params.scenarioId)
    .eq("status", "sent")
    .in("recipient_client_record_id", clientIds);
  if (lErr) throw new Error(`ma_send_logs 取得失敗: ${lErr.message}`);
  const sentSet = new Set(
    (sentLogs ?? []).map((r) => r.recipient_client_record_id).filter((id): id is string => !!id),
  );

  return clients
    .filter((c) => !interactedSet.has(c.id) && !sentSet.has(c.id))
    .map((c) => ({
      clientRecordId: c.id,
      clientName: c.name,
      clientEmail: c.email,
      assignedMemberId: c.assigned_member_id,
    }));
}

/**
 * dormant_outreach:
 *   最新 client_interactions.occurred_at が今日から {days} 日以上前
 *   AND ステータスがクローズ済みでない
 *
 * 「重複送信防止」については過去 30 日以内に同シナリオで送信済みの求職者を除外する
 * (休眠掘り起こしは間隔を空けて何度でも送るのが運用上自然なため)。
 */
export async function findDormantOutreachCandidates(
  supabase: SupabaseClient,
  params: { organizationId: string; scenarioId: string; days: number },
): Promise<CandidateRow[]> {
  const cutoff = new Date(Date.now() - params.days * 86400 * 1000).toISOString();
  const recentlySentCutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

  // 1) このシナリオで「過去 30 日以内」に送信済みの求職者を引く(除外用)
  const { data: recentLogs, error: lErr } = await supabase
    .from("ma_send_logs")
    .select("recipient_client_record_id")
    .eq("scenario_id", params.scenarioId)
    .eq("status", "sent")
    .gte("sent_at", recentlySentCutoff);
  if (lErr) throw new Error(`ma_send_logs 取得失敗: ${lErr.message}`);
  const recentlySentSet = new Set(
    (recentLogs ?? []).map((r) => r.recipient_client_record_id).filter((id): id is string => !!id),
  );

  // 2) この組織の active な client_records を全件
  //    かつ email_distribution_enabled = true(配信停止フラグ尊重)
  const { data: clients, error: cErr } = await supabase
    .from("client_records")
    .select("id, name, email, assigned_member_id, status")
    .eq("organization_id", params.organizationId)
    .eq("email_distribution_enabled", true)
    .not("status", "in", "(completed,declined)");
  if (cErr) throw new Error(`client_records 取得失敗: ${cErr.message}`);
  if (!clients || clients.length === 0) return [];

  const candidateIds = clients.map((c) => c.id).filter((id) => !recentlySentSet.has(id));
  if (candidateIds.length === 0) return [];

  // 3) 各 client の最新 interaction を引く(なければ「Interactions 無し」扱い = 対象外、
  //    register_meeting_promotion の責務)
  const { data: interactions, error: iErr } = await supabase
    .from("client_interactions")
    .select("client_record_id, occurred_at")
    .in("client_record_id", candidateIds)
    .order("occurred_at", { ascending: false });
  if (iErr) throw new Error(`client_interactions 取得失敗: ${iErr.message}`);

  // client_record_id ごとの最新 occurred_at を集計
  const latestByClient = new Map<string, string>();
  for (const row of interactions ?? []) {
    if (!latestByClient.has(row.client_record_id)) {
      latestByClient.set(row.client_record_id, row.occurred_at);
    }
  }

  // cutoff より古い latest を持つ求職者だけが対象
  return clients
    .filter((c) => {
      const latest = latestByClient.get(c.id);
      if (!latest) return false; // interactions ゼロは register シナリオ担当
      return latest <= cutoff;
    })
    .filter((c) => !recentlySentSet.has(c.id))
    .map((c) => ({
      clientRecordId: c.id,
      clientName: c.name,
      clientEmail: c.email,
      assignedMemberId: c.assigned_member_id,
    }));
}
