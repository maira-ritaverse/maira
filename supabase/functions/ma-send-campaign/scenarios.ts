/**
 * シナリオ判定ロジック
 *
 * 実装済 シナリオ:
 *   register_meeting_promotion: 求職者 登録 から N 日 経過 で interactions 0 件
 *   dormant_outreach:           最終 interaction から N 日 以上 経過
 *   meeting_reminder:           interviews.scheduled_at が 今 から |N| 日 後 (N が 負)
 *   job_introduction:           面談 完了 (interview 'first' result='done') から N 日 経過 で referrals 0 件
 *   after_interview_followup:   interviews 'second'/'final' 実施 から N 日 経過
 *   post_placement_followup:    referrals.status='joined' から N 日 経過
 *   birthday_greeting:          client_records.birthday が 今日 の MM-DD と 一致
 *
 * 設計方針:
 *   - 全クエリは service_role キー(RLS bypass)で実行する想定
 *   - 同一 client × 同一 scenario への重複送信を防ぐため、
 *     ma_send_logs に status='sent' の行があるかチェックする
 *   - 「未登録メアド」「クローズ済みステータス」は呼び出し側で除外しない
 *     → 判定クエリで弾く(declined / completed のステータスは送らない)
 */

// 型は Edge Function 内で完結させる(Web 側の型を import すると Myaira 全体のビルドが必要になる)
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

// ============================================================
// 共通 ヘルパー
// ============================================================

/**
 * 同 シナリオ で 既送信 (status='sent') の client_record_id を 集合 で 返す。
 * 重複 送信 防止 の 共通 処理。
 */
async function loadSentClientIds(
  supabase: SupabaseClient,
  scenarioId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("ma_send_logs")
    .select("recipient_client_record_id")
    .eq("scenario_id", scenarioId)
    .eq("status", "sent");
  return new Set(
    ((data ?? []) as Array<{ recipient_client_record_id: string | null }>)
      .map((r) => r.recipient_client_record_id)
      .filter((id): id is string => !!id),
  );
}

async function loadClientRows(
  supabase: SupabaseClient,
  organizationId: string,
  clientIds: string[],
): Promise<
  Array<{
    id: string;
    name: string;
    email: string;
    assigned_member_id: string | null;
  }>
> {
  if (clientIds.length === 0) return [];
  const { data } = await supabase
    .from("client_records")
    .select("id, name, email, assigned_member_id")
    .eq("organization_id", organizationId)
    .eq("email_distribution_enabled", true)
    .in("id", clientIds);
  return (data ?? []) as Array<{
    id: string;
    name: string;
    email: string;
    assigned_member_id: string | null;
  }>;
}

// ============================================================
// meeting_reminder:面談 予定 日 の N 日 前 (N は 負 値、 例 -1)
// ============================================================
/**
 * interviews.scheduled_at が
 *   [now() + |days| 日 - 12h, now() + |days| 日 + 12h] の 範囲 (= 当日 ± 半日)
 * かつ result='scheduled' な 行 を 対象 とする。
 *
 * 同 client に 1 度 だけ 送信 (再送 防止)。
 */
export async function findMeetingReminderCandidates(
  supabase: SupabaseClient,
  params: { organizationId: string; scenarioId: string; days: number },
): Promise<CandidateRow[]> {
  // days は 起点 (= 面談 日) から 何 日 後 か。 通常 -1 (1 日 前 リマインド)。
  const targetTime = Date.now() + params.days * 86400 * 1000;
  const windowMs = 12 * 3600 * 1000;
  const lower = new Date(targetTime - windowMs).toISOString();
  const upper = new Date(targetTime + windowMs).toISOString();

  const { data: interviews, error } = await supabase
    .from("interviews")
    .select("id, referral_id, scheduled_at, result, referrals!inner(client_record_id)")
    .eq("organization_id", params.organizationId)
    .eq("result", "scheduled")
    .gte("scheduled_at", lower)
    .lte("scheduled_at", upper);
  if (error) throw new Error(`interviews 取得失敗: ${error.message}`);
  type IVRow = {
    id: string;
    referral_id: string;
    referrals: { client_record_id: string } | { client_record_id: string }[] | null;
  };
  const rows = ((interviews ?? []) as IVRow[])
    .map((r) => {
      const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
      return ref ? { interviewId: r.id, clientRecordId: ref.client_record_id } : null;
    })
    .filter((x): x is { interviewId: string; clientRecordId: string } => !!x);
  if (rows.length === 0) return [];

  const sentSet = await loadSentClientIds(supabase, params.scenarioId);
  const targetIds = Array.from(
    new Set(rows.map((r) => r.clientRecordId).filter((id) => !sentSet.has(id))),
  );
  const clients = await loadClientRows(supabase, params.organizationId, targetIds);
  return clients.map((c) => ({
    clientRecordId: c.id,
    clientName: c.name,
    clientEmail: c.email,
    assignedMemberId: c.assigned_member_id,
  }));
}

// ============================================================
// job_introduction:1 次 面談 完了 から N 日 経過、 referrals 0 件
// ============================================================
export async function findJobIntroductionCandidates(
  supabase: SupabaseClient,
  params: { organizationId: string; scenarioId: string; days: number },
): Promise<CandidateRow[]> {
  const cutoff = new Date(Date.now() - params.days * 86400 * 1000).toISOString();

  // 1) result='done' な 「first」 interview が cutoff より 古い
  const { data: interviews, error } = await supabase
    .from("interviews")
    .select("referral_id, scheduled_at, referrals!inner(client_record_id)")
    .eq("organization_id", params.organizationId)
    .eq("kind", "first")
    .eq("result", "done")
    .lte("scheduled_at", cutoff);
  if (error) throw new Error(`interviews 取得失敗: ${error.message}`);
  type IVRow = {
    referrals: { client_record_id: string } | { client_record_id: string }[] | null;
  };
  const clientIds = Array.from(
    new Set(
      ((interviews ?? []) as IVRow[])
        .map((r) => {
          const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
          return ref?.client_record_id;
        })
        .filter((id): id is string => !!id),
    ),
  );
  if (clientIds.length === 0) return [];

  // 2) referrals が 0 件 の client_record_id だけ 残す
  const { data: refs } = await supabase
    .from("referrals")
    .select("client_record_id")
    .eq("organization_id", params.organizationId)
    .in("client_record_id", clientIds);
  const refSet = new Set(
    ((refs ?? []) as Array<{ client_record_id: string }>).map((r) => r.client_record_id),
  );
  const noRefsClientIds = clientIds.filter((id) => !refSet.has(id));

  const sentSet = await loadSentClientIds(supabase, params.scenarioId);
  const targetIds = noRefsClientIds.filter((id) => !sentSet.has(id));
  const clients = await loadClientRows(supabase, params.organizationId, targetIds);
  return clients.map((c) => ({
    clientRecordId: c.id,
    clientName: c.name,
    clientEmail: c.email,
    assignedMemberId: c.assigned_member_id,
  }));
}

// ============================================================
// after_interview_followup:second / final 面接 done から N 日 経過
// ============================================================
export async function findAfterInterviewFollowupCandidates(
  supabase: SupabaseClient,
  params: { organizationId: string; scenarioId: string; days: number },
): Promise<CandidateRow[]> {
  const cutoff = new Date(Date.now() - params.days * 86400 * 1000).toISOString();
  const { data: interviews, error } = await supabase
    .from("interviews")
    .select("referral_id, scheduled_at, referrals!inner(client_record_id)")
    .eq("organization_id", params.organizationId)
    .in("kind", ["second", "final", "company"])
    .eq("result", "done")
    .lte("scheduled_at", cutoff);
  if (error) throw new Error(`interviews 取得失敗: ${error.message}`);
  type IVRow = {
    referrals: { client_record_id: string } | { client_record_id: string }[] | null;
  };
  const clientIds = Array.from(
    new Set(
      ((interviews ?? []) as IVRow[])
        .map((r) => {
          const ref = Array.isArray(r.referrals) ? r.referrals[0] : r.referrals;
          return ref?.client_record_id;
        })
        .filter((id): id is string => !!id),
    ),
  );
  if (clientIds.length === 0) return [];

  const sentSet = await loadSentClientIds(supabase, params.scenarioId);
  const targetIds = clientIds.filter((id) => !sentSet.has(id));
  const clients = await loadClientRows(supabase, params.organizationId, targetIds);
  return clients.map((c) => ({
    clientRecordId: c.id,
    clientName: c.name,
    clientEmail: c.email,
    assignedMemberId: c.assigned_member_id,
  }));
}

// ============================================================
// post_placement_followup:referrals.status='joined' から N 日 経過
// ============================================================
export async function findPostPlacementFollowupCandidates(
  supabase: SupabaseClient,
  params: { organizationId: string; scenarioId: string; days: number },
): Promise<CandidateRow[]> {
  const cutoff = new Date(Date.now() - params.days * 86400 * 1000).toISOString();
  const { data: refs, error } = await supabase
    .from("referrals")
    .select("client_record_id, status, updated_at")
    .eq("organization_id", params.organizationId)
    .eq("status", "joined")
    .lte("updated_at", cutoff);
  if (error) throw new Error(`referrals 取得失敗: ${error.message}`);
  const clientIds = Array.from(
    new Set(
      ((refs ?? []) as Array<{ client_record_id: string }>)
        .map((r) => r.client_record_id)
        .filter((id): id is string => !!id),
    ),
  );
  if (clientIds.length === 0) return [];

  const sentSet = await loadSentClientIds(supabase, params.scenarioId);
  const targetIds = clientIds.filter((id) => !sentSet.has(id));
  const clients = await loadClientRows(supabase, params.organizationId, targetIds);
  return clients.map((c) => ({
    clientRecordId: c.id,
    clientName: c.name,
    clientEmail: c.email,
    assignedMemberId: c.assigned_member_id,
  }));
}

// ============================================================
// birthday_greeting:client_records.birth_date の MM-DD が 今日 と 一致
//
// 既存 EMPRO 拡張 (20260615100001) で birth_date date 列 が ある ので 流用。
// (誕生日 列 を 新規 追加 する 必要 が ない こと が 開発 中 に 判明)
// ============================================================
export async function findBirthdayGreetingCandidates(
  supabase: SupabaseClient,
  params: { organizationId: string; scenarioId: string },
): Promise<CandidateRow[]> {
  // 重複 送信 防止: 過去 1 年 以内 に 同 シナリオ で 送信 済 の client を 除外
  const oneYearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString();
  const { data: recentLogs } = await supabase
    .from("ma_send_logs")
    .select("recipient_client_record_id")
    .eq("scenario_id", params.scenarioId)
    .eq("status", "sent")
    .gte("sent_at", oneYearAgo);
  const recentlySent = new Set(
    ((recentLogs ?? []) as Array<{ recipient_client_record_id: string | null }>)
      .map((r) => r.recipient_client_record_id)
      .filter((id): id is string => !!id),
  );

  // SQL 側 で JST 基準 の 今日 誕生日 を フィルタ する RPC を 呼ぶ
  // (旧: 全件 取得 + JS で MM-DD 比較 = 1000 件 で 999 件 不要 読み込み)
  const { data: clients, error } = await supabase.rpc("list_birthday_clients_today_for_org", {
    p_organization_id: params.organizationId,
  });
  if (error) throw new Error(`client_records 取得失敗: ${error.message}`);
  type CRow = {
    id: string;
    name: string;
    email: string;
    assigned_member_id: string | null;
  };
  return ((clients ?? []) as CRow[])
    .filter((c) => !recentlySent.has(c.id))
    .map((c) => ({
      clientRecordId: c.id,
      clientName: c.name,
      clientEmail: c.email,
      assignedMemberId: c.assigned_member_id,
    }));
}
