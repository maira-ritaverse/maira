/**
 * クライアントレコード(企業所有)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業のクライアントのみが返る。
 * (求職者本人は、自分に紐づいた linked 状態のレコードのみ閲覧可)
 */

import { createClient } from "@/lib/supabase/server";
import { decryptField } from "@/lib/crypto/field-encryption";
import type {
  ClientCloseReason,
  ClientRecord,
  ClientRecordWithAssignee,
  ClientRecordWithAssigneeAndDues,
  ClientRecordWithDecrypted,
  ClientRecordWithReferralBreakdown,
  ClientRecordWithUpdateBadge,
  ReferralBreakdown,
} from "./types";
import type { ReferralStatus } from "@/lib/referrals/types";
import { computeHasUnreadUpdate, maxIsoTimestamp } from "./update-badge";

type ClientRecordRow = {
  id: string;
  organization_id: string;
  assigned_member_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  link_status: string;
  linked_user_id: string | null;
  linked_at: string | null;
  revoked_at: string | null;
  // 二段階解除(P3〜P6)用の列。P1+P2 マイグレーションで nullable で追加された。
  revoke_requested_at: string | null;
  revoke_deadline: string | null;
  revoke_confirmed_via: string | null;
  notes: string | null;
  // マイグレーション 20260615000005 で追加された列。
  // 既存レコードは ALTER 直後は null(close_reason) / true(default、email_distribution_enabled)。
  close_reason: string | null;
  email_distribution_enabled: boolean;
  entry_site: string | null;
  // 暗号化された生データ。rowToClientRecord では復号しない(一覧で N+1 を避けるため)。
  // 詳細クエリで select したい場合のみ詰める。
  encrypted_recommendation_comment: string | null;
  encrypted_other_agency_status: string | null;
  encrypted_contact_method_preference: string | null;
  // ────────────────────────────────────────────
  // EMPRO 拡張(マイグレーション 20260615100001)
  // ────────────────────────────────────────────
  name_kana: string | null;
  birth_date: string | null;
  gender: string | null;
  nationality: string | null;
  marital_status: string | null;
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  street: string | null;
  building: string | null;
  phone2: string | null;
  email2: string | null;
  current_employment_type: string | null;
  current_annual_income: number | null;
  final_education: string | null;
  encrypted_education_detail: string | null;
  experience_industries: string[] | null;
  experience_occupations: string[] | null;
  encrypted_skills: string | null;
  desired_industries: string[] | null;
  desired_occupations: string[] | null;
  desired_locations: string[] | null;
  desired_annual_income: number | null;
  job_change_timing: string | null;
  encrypted_job_change_reason: string | null;
  encrypted_desired_conditions: string | null;
  intake_date: string | null;
  first_meeting_date: string | null;
  encrypted_meeting_notes: string | null;
  encrypted_status_memo: string | null;
  // CRM 自由タグ(20260615140001 マイグレーション)
  crm_tags: string[] | null;

  // カスタムフィールド値(20260615210001)
  custom_fields: Record<string, unknown> | null;

  created_at: string;
  updated_at: string;
};

function rowToClientRecord(row: ClientRecordRow): ClientRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    assignedMemberId: row.assigned_member_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status as ClientRecord["status"],
    linkStatus: row.link_status as ClientRecord["linkStatus"],
    linkedUserId: row.linked_user_id,
    linkedAt: row.linked_at,
    revokedAt: row.revoked_at,
    revokeRequestedAt: row.revoke_requested_at,
    revokeDeadline: row.revoke_deadline,
    // DB CHECK 制約で値域は 'agency_approved' / 'timeout' に限定済み
    revokeConfirmedVia: row.revoke_confirmed_via as ClientRecord["revokeConfirmedVia"],
    notes: row.notes,
    // CHECK 制約で値域は 7 種類 + null に限定済み
    closeReason: row.close_reason as ClientRecord["closeReason"],
    emailDistributionEnabled: row.email_distribution_enabled,
    entrySite: row.entry_site,
    // 暗号文の存在のみで「他社エージェント利用情報の有無」を導出。
    // 復号はしない(N+1 を避けるため、一覧用クエリでも安全に使える)。
    hasOtherAgencyStatus:
      row.encrypted_other_agency_status !== null && row.encrypted_other_agency_status !== "",
    // EMPRO 拡張(平文。一覧で使うため復号は不要、そのまま透過)。
    // DB enum を ClientRecord 上の type union に narrow。CHECK 制約で値域は担保済み。
    nameKana: row.name_kana,
    birthDate: row.birth_date,
    gender: row.gender as ClientRecord["gender"],
    nationality: row.nationality,
    maritalStatus: row.marital_status as ClientRecord["maritalStatus"],
    postalCode: row.postal_code,
    prefecture: row.prefecture,
    city: row.city,
    street: row.street,
    building: row.building,
    phone2: row.phone2,
    email2: row.email2,
    currentEmploymentType: row.current_employment_type as ClientRecord["currentEmploymentType"],
    currentAnnualIncome: row.current_annual_income,
    finalEducation: row.final_education as ClientRecord["finalEducation"],
    // text[] は null も「未入力」も意味するが、UI 側は常に配列で扱いたいので [] に統一。
    experienceIndustries: row.experience_industries ?? [],
    experienceOccupations: row.experience_occupations ?? [],
    desiredIndustries: row.desired_industries ?? [],
    desiredOccupations: row.desired_occupations ?? [],
    desiredLocations: row.desired_locations ?? [],
    desiredAnnualIncome: row.desired_annual_income,
    jobChangeTiming: row.job_change_timing as ClientRecord["jobChangeTiming"],
    intakeDate: row.intake_date,
    firstMeetingDate: row.first_meeting_date,
    // CRM タグは DB default '{}' なので null は来ない契約だが、念のため [] にフォールバック。
    crmTags: row.crm_tags ?? [],
    // カスタムフィールドも DB default '{}'::jsonb。
    customFields: row.custom_fields ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================
// 分布サマリ集計(失注理由・チャネル別)
// ============================================

/**
 * クライアント全体の分布サマリ。失注理由(close_reason)と
 * エントリーサイト(entry_site)の 2 軸を返す。
 */
export type ClientDistributionStats = {
  closeReasons: Record<string, number>;
  entrySites: Record<string, number>;
  totalClients: number;
};

/**
 * close_reason の集計純粋関数。
 *
 * 値が null/空文字のレコードは `"unset"` キーにまとめる。
 * テスト・リファクタリングしやすいよう DB アクセスから分離する。
 */
export function aggregateCloseReasons(
  rows: { close_reason: string | null }[],
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const row of rows) {
    const key = row.close_reason && row.close_reason !== "" ? row.close_reason : "unset";
    acc[key] = (acc[key] ?? 0) + 1;
  }
  return acc;
}

/**
 * entry_site の集計純粋関数。
 *
 * 大文字小文字や全角半角の正規化はしない(運用上「リクナビ」「Recnabi」が
 * 同じ媒体だと言える保証がないため。「同名で書く」のは運用ルール側で吸収する)。
 */
export function aggregateEntrySites(rows: { entry_site: string | null }[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const row of rows) {
    const key = row.entry_site && row.entry_site.trim() !== "" ? row.entry_site : "unset";
    acc[key] = (acc[key] ?? 0) + 1;
  }
  return acc;
}

/**
 * 組織全体のクライアント分布を集計して返す(close_reason × entry_site)。
 *
 * 一覧トップに表示するサマリカード用。N+1 を避けるため 1 クエリで両軸の元データを取得し、
 * 純粋関数で集計する。
 */
export async function getClientDistributionStats(
  organizationId: string,
): Promise<ClientDistributionStats> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_records")
    .select("close_reason, entry_site")
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`クライアント分布の集計に失敗しました: ${error.message}`);
  }
  const rows = data ?? [];
  return {
    closeReasons: aggregateCloseReasons(rows),
    entrySites: aggregateEntrySites(rows),
    totalClients: rows.length,
  };
}

// 公開する型エイリアス(close_reason のキーセット)を再エクスポートしておくと、
// UI 側で Record の key 型を絞り込みやすい。
export type { ClientCloseReason };

/**
 * 企業のクライアント総件数を取得(ページネーション / アラート判定用)。
 *
 * head: true で行データを取らずに count だけ返すので高速。
 * 失敗時は null を返し、呼び出し側で「不明」フォールバック表示を許す。
 */
export async function getClientRecordsTotalCount(organizationId: string): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("client_records")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (error) return null;
  return count ?? null;
}

/**
 * ページネーション付きクライアント一覧(基盤)
 *
 * 「全件 + JS フィルタ」が現状の主要パターンだが、組織が一定規模を超えると
 * メモリ負荷とハイドレーション時間が増えるため、サーバー側で limit/offset を
 * 効かせて取得する基盤を提供する。
 *
 * 用途:
 *   - ダッシュボードの「最近登録された顧客」widget
 *   - 将来の「ページ送り UI」(現状の clients-view-tabs は全件読みで動く)
 *
 * RLS で自社のみ取得。担当者名 / referralBreakdown は load しない
 * (それらを足す上位 API は listClientRecordsWith* シリーズに集約)。
 */
export async function listClientRecordsPaginated(
  organizationId: string,
  opts: { limit: number; offset?: number; orderBy?: "created_at" | "updated_at" } = {
    limit: 50,
    offset: 0,
    orderBy: "created_at",
  },
): Promise<ClientRecord[]> {
  const supabase = await createClient();
  const offset = opts.offset ?? 0;
  const orderBy = opts.orderBy ?? "created_at";

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("organization_id", organizationId)
    .order(orderBy, { ascending: false })
    .range(offset, offset + opts.limit - 1);

  if (error || !data) return [];
  return (data as ClientRecordRow[]).map(rowToClientRecord);
}

/**
 * 企業のクライアント一覧を取得
 * RLS により、自社のクライアントのみ取得される
 */
export async function listClientRecords(organizationId: string): Promise<ClientRecord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as ClientRecordRow[]).map(rowToClientRecord);
}

/**
 * 自組織 の client_records から 使われて いる crm_tags 一覧 を 取得 (unique、 ソート 済)。
 *
 * LINE 一斉送信 の タグ フィルタ ピッカー で 使う。 件数 が 増えて も
 * unique タグ 数 は 通常 数十 件 以内 と 想定 されて いる ため、 全 行 SELECT で 集計。
 */
export async function listOrganizationCrmTags(organizationId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_records")
    .select("crm_tags")
    .eq("organization_id", organizationId)
    .not("crm_tags", "is", null);
  type Row = { crm_tags: string[] | null };
  const set = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    for (const t of r.crm_tags ?? []) {
      const trimmed = t.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
}

/**
 * 単一のクライアントレコードを取得
 */
export async function getClientRecord(clientId: string): Promise<ClientRecord | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !data) return null;

  return rowToClientRecord(data as ClientRecordRow);
}

/**
 * 詳細画面用に、暗号化フィールドを復号した拡張型で 1 件を返す。
 *
 * 一覧クエリで使うと N 件分の復号が走るためコストが高い。詳細表示・編集用に限定する。
 * 復号エラー(鍵不一致等)は throw して呼び出し側で 500 にする方針。
 */
export async function getClientRecordWithDecrypted(
  clientId: string,
): Promise<ClientRecordWithDecrypted | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as ClientRecordRow;
  const base = rowToClientRecord(row);
  // 復号は並列(各フィールドは独立)。null 入力は null のまま返る契約。
  // 既存 3 + EMPRO 拡張 6 = 9 並列。WebCrypto は CPU バウンドなので並列化の意味は薄いが、
  // I/O としては 1 ラウンドにまとまる(Promise.all は同期的に await キューに入る)。
  const [
    recommendationComment,
    otherAgencyStatus,
    contactMethodPreference,
    educationDetail,
    skills,
    jobChangeReason,
    desiredConditions,
    meetingNotes,
    statusMemo,
  ] = await Promise.all([
    decryptField(row.encrypted_recommendation_comment),
    decryptField(row.encrypted_other_agency_status),
    decryptField(row.encrypted_contact_method_preference),
    decryptField(row.encrypted_education_detail),
    decryptField(row.encrypted_skills),
    decryptField(row.encrypted_job_change_reason),
    decryptField(row.encrypted_desired_conditions),
    decryptField(row.encrypted_meeting_notes),
    decryptField(row.encrypted_status_memo),
  ]);
  return {
    ...base,
    // decryptField のオーバーロードで undefined も返り得るが、ClientRecordWithDecrypted は
    // null 表現で揃えたいので明示的に正規化する。
    recommendationComment: recommendationComment ?? null,
    otherAgencyStatus: otherAgencyStatus ?? null,
    contactMethodPreference: contactMethodPreference ?? null,
    educationDetail: educationDetail ?? null,
    skills: skills ?? null,
    jobChangeReason: jobChangeReason ?? null,
    desiredConditions: desiredConditions ?? null,
    meetingNotes: meetingNotes ?? null,
    statusMemo: statusMemo ?? null,
  };
}

/**
 * 担当アドバイザー名を含む企業のクライアント一覧を取得
 *
 * 一覧テーブル表示用。listClientRecords と同じく RLS により
 * 自社のクライアントのみ返る。
 *
 * 担当者名の取得手順:
 *   1. client_records を取得
 *   2. SECURITY DEFINER 関数 list_organization_member_display_names で
 *      組織メンバーの (member_id, display_name) Map を作成
 *      (profiles の RLS は緩めずに display_name のみを公開するため)
 *   3. assigned_member_id をキーに表示名を合流
 *
 * 担当者未割当・display_name 未設定の場合は assigneeName = null。
 */
export async function listClientRecordsWithAssignee(
  organizationId: string,
): Promise<ClientRecordWithAssignee[]> {
  const supabase = await createClient();

  const { data: clientRows, error: clientError } = await supabase
    .from("client_records")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (clientError || !clientRows) return [];

  const clients = (clientRows as ClientRecordRow[]).map(rowToClientRecord);

  // 組織メンバーの表示名 Map を取得(RLS バイパス関数経由)
  const { data: memberRows, error: memberError } = await supabase.rpc(
    "list_organization_member_display_names",
    { target_organization_id: organizationId },
  );

  // メンバー名取得に失敗してもクライアント一覧自体は返す(担当者名のみ null)
  const nameByMemberId = new Map<string, string | null>();
  if (!memberError && memberRows) {
    for (const row of memberRows as Array<{ member_id: string; display_name: string | null }>) {
      nameByMemberId.set(row.member_id, row.display_name);
    }
  }

  return clients.map((client) => ({
    ...client,
    assigneeName: client.assignedMemberId
      ? (nameByMemberId.get(client.assignedMemberId) ?? null)
      : null,
  }));
}

/**
 * クライアント一覧 + 担当者名 + 「未完了タスクの期限リスト」
 *
 * N+1 回避のため、未完了タスクは organization スコープで「1回だけ」
 * 取得し、JS で client_record_id ごとに集約する。
 * タスクは 1 クライアントあたり数件想定なので、組織全体でも数百件以内が現実的。
 *
 * 期限超過/間近の判定はサーバではせず生の due_at のリストを返す。
 * 理由:画面表示後しばらく経つと「今」がズレるため、判定はクライアント側で
 * useNow と組み合わせて行う(期限色分けと同じ方針)。
 */
export async function listClientRecordsWithAssigneeAndDues(
  organizationId: string,
): Promise<ClientRecordWithAssigneeAndDues[]> {
  const supabase = await createClient();

  // 1. 既存ロジックでクライアント + 担当者名を取得
  const clients = await listClientRecordsWithAssignee(organizationId);

  // 2. 同 organization の未完了タスクを1クエリで取得
  //    select は必要最小限(client_record_id と due_at のみ)
  const { data: taskRows, error } = await supabase
    .from("agency_tasks")
    .select("client_record_id, due_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  if (error || !taskRows) {
    // タスク取得に失敗してもクライアント一覧自体は返す(バッジが出ないだけ)
    return clients.map((c) => ({ ...c, pendingDueAts: [] }));
  }

  // 3. client_record_id ごとに due_at を寄せる
  const duesByClientId = new Map<string, (string | null)[]>();
  for (const row of taskRows as Array<{ client_record_id: string; due_at: string | null }>) {
    const arr = duesByClientId.get(row.client_record_id) ?? [];
    arr.push(row.due_at);
    duesByClientId.set(row.client_record_id, arr);
  }

  return clients.map((c) => ({
    ...c,
    pendingDueAts: duesByClientId.get(c.id) ?? [],
  }));
}

/**
 * クライアント一覧 + 担当者 + 期限リスト + 「応募状況(referral 段階別件数)」
 *
 * `listClientRecordsWithAssigneeAndDues` の上に「応募状況」を 1 クエリで足す。
 * クライアント一覧画面で「1 求職者が今 何社受けてて、どの段階か」を一目で
 * 出すために使う。
 *
 * 取り方:
 *   - 同 organization の referrals を 1 回だけ SELECT(client_record_id, status)
 *   - JS で client_record_id 別に status 件数を集約
 *   - 0 件の status はキーごと持たない(描画側で「ある段階だけ」表示するため)
 *
 * ⚠️ N+1 にしない(全体で SELECT 1 回追加だけ)。
 * ⚠️ organization スコープ。RLS で自社のみだが、明示 eq で二重防御。
 *
 * 失敗時の挙動:referrals の取得に失敗してもクライアント一覧自体は返す
 * (応募状況がバッジ無しで表示されるだけで、画面は壊れない)。
 */
export async function listClientRecordsWithReferralBreakdown(
  organizationId: string,
): Promise<ClientRecordWithReferralBreakdown[]> {
  const supabase = await createClient();

  // 1) 既存ロジックでクライアント + 担当者 + 期限を取得
  const clients = await listClientRecordsWithAssigneeAndDues(organizationId);

  // 2) 同 organization の referrals を 1 クエリで取得(必要最小限の 2 カラム)
  const { data: refRows, error } = await supabase
    .from("referrals")
    .select("client_record_id, status")
    .eq("organization_id", organizationId);

  if (error || !refRows) {
    // 失敗してもクライアント一覧は返す(応募状況は空で)
    return clients.map((c) => ({
      ...c,
      referralBreakdown: { byStatus: {}, total: 0 },
    }));
  }

  // 3) client_record_id ごとに status 別件数を集約
  //    Map<clientId, Map<status, count>> の形で持って、最後にプレーンオブジェクト化。
  const breakdownByClient = new Map<string, Map<ReferralStatus, number>>();
  for (const row of refRows as Array<{ client_record_id: string; status: string }>) {
    const status = row.status as ReferralStatus;
    const inner = breakdownByClient.get(row.client_record_id) ?? new Map();
    inner.set(status, (inner.get(status) ?? 0) + 1);
    breakdownByClient.set(row.client_record_id, inner);
  }

  return clients.map((c) => {
    const inner = breakdownByClient.get(c.id);
    if (!inner) {
      return { ...c, referralBreakdown: { byStatus: {}, total: 0 } };
    }
    const byStatus: Partial<Record<ReferralStatus, number>> = {};
    let total = 0;
    for (const [status, count] of inner.entries()) {
      byStatus[status] = count;
      total += count;
    }
    const referralBreakdown: ReferralBreakdown = { byStatus, total };
    return { ...c, referralBreakdown };
  });
}

/**
 * クライアント一覧 + 担当者 + 期限 + 応募状況 + 「新着・更新バッジ」フラグ
 *
 * `listClientRecordsWithReferralBreakdown` の上に「メンバー個人が前回見た時刻 vs
 * 本人データ最新更新時刻」の比較結果を足す。一覧画面のバッジ表示専用。
 *
 * 開示範囲の方針:
 *   linked または期限内 revoke_requested の自組織クライアントのみ判定対象。
 *   それ以外(unlinked/invited/revoked、期限超過 revoke_requested)は
 *   hasUnreadUpdate=false / latestUpdatedAt=null に倒す
 *   (本人データを見られない状態でバッジを出しても意味がない)。
 *
 * クエリ本数(クライアント件数に依存しない固定本数):
 *   - 既存: listClientRecordsWithReferralBreakdown(中で client_records / 担当者名 /
 *           agency_tasks / referrals の 4 本)
 *   - 追加: resumes(1) + cvs(1) + career_profile RPC(1) + client_view_states(1)
 *   合計 8 本固定。N+1 は発生しない(全て IN(...) で 1 回ずつ)。
 *
 * 失敗時の挙動:
 *   いずれかの追加クエリが落ちてもクライアント一覧自体は返す
 *   (バッジが出ないだけで画面は壊れない)。既存の N+1 回避関数群と同じ方針。
 */
export async function listClientRecordsWithUpdateBadge(
  organizationId: string,
  viewerUserId: string,
): Promise<ClientRecordWithUpdateBadge[]> {
  const supabase = await createClient();

  // 1) 既存ラッパでクライアント取得(N+1 回避組み立て済み)
  const clients = await listClientRecordsWithReferralBreakdown(organizationId);

  // 2) 開示範囲(linked または期限内 revoke_requested)の対象を絞る。
  //    範囲は resumes/cvs の RLS(20260607000011)と career_profile RPC の認可と
  //    完全に揃える。範囲外のクライアントは判定スキップする(バッジ常に false)。
  const nowMs = Date.now();
  const isDisclosable = (c: ClientRecordWithReferralBreakdown): boolean => {
    if (!c.linkedUserId) return false;
    if (c.linkStatus === "linked") return true;
    if (c.linkStatus === "revoke_requested" && c.revokeDeadline) {
      return new Date(c.revokeDeadline).getTime() > nowMs;
    }
    return false;
  };

  const disclosable = clients.filter(isDisclosable);

  // 最終対応日時(沈黙アラート用)+ 次の面談 を並列に集約。
  const nowIso = new Date().toISOString();
  const [interactionRowsRes, nextMeetingRowsRes] = await Promise.all([
    supabase
      .from("client_interactions")
      .select("client_record_id, occurred_at")
      .order("occurred_at", { ascending: false }),
    // meeting_schedules:本人組織分の今後の予約(キャンセル除外)を starts_at 昇順
    supabase
      .from("meeting_schedules")
      .select("client_record_id, starts_at")
      .eq("organization_id", organizationId)
      .neq("status", "canceled")
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true }),
  ]);

  const lastInteractionByClientId = new Map<string, string>();
  if (!interactionRowsRes.error && interactionRowsRes.data) {
    for (const row of interactionRowsRes.data as Array<{
      client_record_id: string;
      occurred_at: string;
    }>) {
      if (!lastInteractionByClientId.has(row.client_record_id)) {
        lastInteractionByClientId.set(row.client_record_id, row.occurred_at);
      }
    }
  }

  // 次の面談 Map(starts_at 昇順なので、先頭採用で最小値が入る)
  const nextMeetingByClientId = new Map<string, string>();
  if (!nextMeetingRowsRes.error && nextMeetingRowsRes.data) {
    for (const row of nextMeetingRowsRes.data as Array<{
      client_record_id: string | null;
      starts_at: string;
    }>) {
      if (!row.client_record_id) continue;
      if (!nextMeetingByClientId.has(row.client_record_id)) {
        nextMeetingByClientId.set(row.client_record_id, row.starts_at);
      }
    }
  }

  // 早期 return:開示対象が無ければ追加クエリ 4 本を投げる必要なし。
  if (disclosable.length === 0) {
    return clients.map((c) => ({
      ...c,
      hasUnreadUpdate: false,
      latestUpdatedAt: null,
      lastInteractionAt: lastInteractionByClientId.get(c.id) ?? null,
      nextMeetingAt: nextMeetingByClientId.get(c.id) ?? null,
    }));
  }

  const linkedUserIds = disclosable
    .map((c) => c.linkedUserId)
    .filter((v): v is string => v !== null);
  const disclosableClientIds = disclosable.map((c) => c.id);

  // 3) 追加クエリ 4 本を並列実行(クライアント件数に依存しない固定本数)。
  //    resumes / cvs は Phase 6 RLS(linked または期限内 revoke_requested の
  //    自組織)で SELECT が通る。career_profile は RPC 経由(同じ認可範囲)。
  //    client_view_states は自分の閲覧記録のみ(user_id = auth.uid())。
  const [resumeRes, cvRes, profileRes, viewStateRes] = await Promise.all([
    supabase.from("resumes").select("user_id, updated_at").in("user_id", linkedUserIds),
    supabase.from("cvs").select("user_id, updated_at").in("user_id", linkedUserIds),
    supabase.rpc("list_linked_clients_career_profile_updated_at", {
      p_client_record_ids: disclosableClientIds,
    }),
    supabase
      .from("client_view_states")
      .select("client_record_id, last_viewed_at")
      .eq("user_id", viewerUserId)
      .in("client_record_id", disclosableClientIds),
  ]);

  // 4) 集約 Map を作る。
  //    resume / cv は同じ「本人(user_id)」軸なので、両方を 1 つの max Map に畳む。
  //    career_profile は RPC の戻りが client_record_id 軸なので別 Map。
  //    閲覧状態も client_record_id 軸。
  const docMaxByUserId = new Map<string, string>();
  const recordUserUpdate = (userId: string, updatedAt: string | null | undefined) => {
    if (!updatedAt) return;
    const cur = docMaxByUserId.get(userId);
    if (!cur || updatedAt > cur) docMaxByUserId.set(userId, updatedAt);
  };
  if (!resumeRes.error && resumeRes.data) {
    for (const r of resumeRes.data as Array<{ user_id: string; updated_at: string }>) {
      recordUserUpdate(r.user_id, r.updated_at);
    }
  }
  if (!cvRes.error && cvRes.data) {
    for (const r of cvRes.data as Array<{ user_id: string; updated_at: string }>) {
      recordUserUpdate(r.user_id, r.updated_at);
    }
  }

  const profileMaxByClientId = new Map<string, string>();
  if (!profileRes.error && profileRes.data) {
    for (const r of profileRes.data as Array<{ client_record_id: string; updated_at: string }>) {
      profileMaxByClientId.set(r.client_record_id, r.updated_at);
    }
  }

  const lastViewedByClientId = new Map<string, string>();
  if (!viewStateRes.error && viewStateRes.data) {
    for (const r of viewStateRes.data as Array<{
      client_record_id: string;
      last_viewed_at: string;
    }>) {
      lastViewedByClientId.set(r.client_record_id, r.last_viewed_at);
    }
  }

  // 5) 各クライアントに hasUnreadUpdate / latestUpdatedAt を付与。
  //    判定は computeHasUnreadUpdate(純粋関数)に委譲する。
  return clients.map((c) => {
    const lastInteractionAt = lastInteractionByClientId.get(c.id) ?? null;
    const nextMeetingAt = nextMeetingByClientId.get(c.id) ?? null;
    if (!isDisclosable(c) || !c.linkedUserId) {
      return {
        ...c,
        hasUnreadUpdate: false,
        latestUpdatedAt: null,
        lastInteractionAt,
        nextMeetingAt,
      };
    }
    const latestUpdatedAt = maxIsoTimestamp([
      docMaxByUserId.get(c.linkedUserId),
      profileMaxByClientId.get(c.id),
    ]);
    const lastViewedAt = lastViewedByClientId.get(c.id) ?? null;
    const hasUnreadUpdate = computeHasUnreadUpdate(latestUpdatedAt, lastViewedAt);
    return { ...c, hasUnreadUpdate, latestUpdatedAt, lastInteractionAt, nextMeetingAt };
  });
}

/**
 * 担当アドバイザー別にクライアントを取得
 */
export async function listClientRecordsByAdvisor(
  organizationId: string,
  memberId: string,
): Promise<ClientRecord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_records")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("assigned_member_id", memberId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as ClientRecordRow[]).map(rowToClientRecord);
}
