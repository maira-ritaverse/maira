/**
 * 紹介(マッチング)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業の紹介のみが返る。
 * client_records/queries.ts と同じ構造で揃えている。
 *
 * 一覧取得は表示用途を想定し、相手テーブル(job_postings / client_records)を
 * Supabase の select で関連取得する。Supabase の型推論は配列・オブジェクト両方を
 * 返しうるので、ローカルで明示的に narrow する。
 */

import { createClient } from "@/lib/supabase/server";
import type {
  Referral,
  ReferralStatus,
  ReferralStatusHistory,
  ReferralStatusHistoryWithAuthor,
  ReferralWithClient,
  ReferralWithJob,
} from "./types";

type ReferralRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  job_posting_id: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function rowToReferral(row: ReferralRow): Referral {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    jobPostingId: row.job_posting_id,
    status: row.status as ReferralStatus,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Supabase の select で関連取得した場合、関連カラムは配列 or オブジェクトのどちらでも来うる。
// 1対1リレーションでも型側は配列扱いになることがあるため、両対応する。
function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

type ReferralWithJobRow = ReferralRow & {
  job_postings:
    | { company_name: string; position: string }
    | { company_name: string; position: string }[]
    | null;
};

type ReferralWithClientRow = ReferralRow & {
  client_records: { name: string; email: string } | { name: string; email: string }[] | null;
};

/**
 * あるクライアントの紹介一覧(求人情報を含む)
 * 推薦が新しい順。
 */
export async function listReferralsByClient(clientRecordId: string): Promise<ReferralWithJob[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("referrals")
    .select(
      `
      *,
      job_postings ( company_name, position )
    `,
    )
    .eq("client_record_id", clientRecordId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as ReferralWithJobRow[]).map((row) => {
    const job = pickOne(row.job_postings);
    return {
      ...rowToReferral(row),
      jobCompanyName: job?.company_name ?? "(削除された求人)",
      jobPosition: job?.position ?? "",
    };
  });
}

/**
 * ある求人への紹介一覧(クライアント情報を含む)
 * 推薦が新しい順。
 */
export async function listReferralsByJob(jobPostingId: string): Promise<ReferralWithClient[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("referrals")
    .select(
      `
      *,
      client_records ( name, email )
    `,
    )
    .eq("job_posting_id", jobPostingId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as ReferralWithClientRow[]).map((row) => {
    const client = pickOne(row.client_records);
    return {
      ...rowToReferral(row),
      clientName: client?.name ?? "(削除されたクライアント)",
      clientEmail: client?.email ?? "",
    };
  });
}

type ReferralWithClientAndJobRow = ReferralRow & {
  client_records: { name: string; email: string } | { name: string; email: string }[] | null;
  job_postings:
    | { company_name: string; position: string }
    | { company_name: string; position: string }[]
    | null;
};

export type ReferralWithClientAndJob = Referral & {
  clientName: string;
  clientEmail: string;
  jobCompanyName: string;
  jobPosition: string;
};

/**
 * 組織全体の紹介を取得(エクスポート用)
 *
 * RLS で自社のみだが二重防御で organization_id eq。
 * クライアントと求人を関連取得して 1 行に展開する。
 */
export async function listReferralsByOrganization(
  organizationId: string,
): Promise<ReferralWithClientAndJob[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("referrals")
    .select(
      `
      *,
      client_records ( name, email ),
      job_postings ( company_name, position )
    `,
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as ReferralWithClientAndJobRow[]).map((row) => {
    const client = pickOne(row.client_records);
    const job = pickOne(row.job_postings);
    return {
      ...rowToReferral(row),
      clientName: client?.name ?? "(削除されたクライアント)",
      clientEmail: client?.email ?? "",
      jobCompanyName: job?.company_name ?? "(削除された求人)",
      jobPosition: job?.position ?? "",
    };
  });
}

/**
 * 単一の紹介を取得
 */
export async function getReferral(referralId: string): Promise<Referral | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("referrals")
    .select("*")
    .eq("id", referralId)
    .maybeSingle();

  if (error || !data) return null;

  return rowToReferral(data as ReferralRow);
}

// ============================================
// 紹介ステータス遷移履歴(referral_status_history)
// ============================================

type ReferralStatusHistoryRow = {
  id: string;
  organization_id: string;
  referral_id: string;
  from_status: string | null;
  to_status: string;
  changed_by_member_id: string | null;
  changed_at: string;
  memo: string | null;
  created_at: string;
};

function rowToReferralStatusHistory(row: ReferralStatusHistoryRow): ReferralStatusHistory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    referralId: row.referral_id,
    fromStatus: row.from_status as ReferralStatus | null,
    toStatus: row.to_status as ReferralStatus,
    changedByMemberId: row.changed_by_member_id,
    changedAt: row.changed_at,
    memo: row.memo,
    createdAt: row.created_at,
  };
}

/**
 * 複数の紹介の status 遷移履歴を、referral_id でグルーピングして返す。
 *
 * クライアント詳細画面で、各紹介に「選考の足跡」を表示するために使う。
 *   - 各紹介の履歴は changed_at 昇順(古い → 新しい)。
 *     上から下にタイムラインが進む読み方が自然なため。
 *   - 変更者の表示名は list_organization_member_display_names(SECURITY DEFINER)
 *     経由で取得して合流。profiles の RLS を緩めずに済ませる
 *     既存の interactions / clients と同じ方針。
 *   - referralIds が空なら DB に問い合わせず空 Map を返す。
 *
 * 戻り値:Map<referralId, histories[]>
 *   履歴が無い referral_id は Map に存在しない(呼び出し元で空配列扱い)。
 */
export async function listReferralStatusHistoriesByReferralIds(
  referralIds: string[],
  organizationId: string,
): Promise<Map<string, ReferralStatusHistoryWithAuthor[]>> {
  const grouped = new Map<string, ReferralStatusHistoryWithAuthor[]>();
  if (referralIds.length === 0) return grouped;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("referral_status_history")
    .select("*")
    .in("referral_id", referralIds)
    .order("changed_at", { ascending: true });

  if (error || !data) return grouped;

  const histories = (data as ReferralStatusHistoryRow[]).map(rowToReferralStatusHistory);

  // 変更者の表示名 Map(RLS バイパス関数経由)。
  // 取得失敗しても履歴自体は返したいので、エラー時は changedByName を null にして続行。
  const { data: memberRows, error: memberError } = await supabase.rpc(
    "list_organization_member_display_names",
    { target_organization_id: organizationId },
  );

  const nameByMemberId = new Map<string, string | null>();
  if (!memberError && memberRows) {
    for (const row of memberRows as Array<{ member_id: string; display_name: string | null }>) {
      nameByMemberId.set(row.member_id, row.display_name);
    }
  }

  for (const h of histories) {
    const withAuthor: ReferralStatusHistoryWithAuthor = {
      ...h,
      changedByName: h.changedByMemberId ? (nameByMemberId.get(h.changedByMemberId) ?? null) : null,
    };
    const list = grouped.get(h.referralId);
    if (list) list.push(withAuthor);
    else grouped.set(h.referralId, [withAuthor]);
  }

  return grouped;
}
