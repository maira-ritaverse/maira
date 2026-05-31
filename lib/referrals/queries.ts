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
import type { Referral, ReferralStatus, ReferralWithClient, ReferralWithJob } from "./types";

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
