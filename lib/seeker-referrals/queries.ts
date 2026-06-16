/**
 * 求職者本人向けの「エージェント側 referrals」取得ヘルパ。
 * RPC `list_seeker_referrals_with_jobs` のラッパ。
 */
import { createClient } from "@/lib/supabase/server";

export type SeekerReferralStatus =
  | "planned"
  | "recommended"
  | "screening"
  | "interview"
  | "offer"
  | "joined"
  | "declined";

export type SeekerReferralRow = {
  referralId: string;
  organizationId: string;
  organizationName: string;
  jobPostingId: string;
  jobCompanyName: string;
  jobPosition: string;
  jobLocation: string | null;
  jobSalaryMin: number | null;
  jobSalaryMax: number | null;
  jobEmploymentType: string | null;
  status: SeekerReferralStatus;
  createdAt: string;
  updatedAt: string;
};

// 注意:エージェントの内部メモ notes は意図的に取得しない
// (求職者には開示しない設計。マイグレーション 20260624000002 で RPC からも除外)
type RpcRow = {
  referral_id: string;
  organization_id: string;
  organization_name: string;
  client_record_id: string;
  job_posting_id: string;
  job_company_name: string;
  job_position: string;
  job_location: string | null;
  job_salary_min: number | null;
  job_salary_max: number | null;
  job_employment_type: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function listSeekerReferrals(): Promise<SeekerReferralRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_seeker_referrals_with_jobs");
  if (error) {
    throw new Error(`list_seeker_referrals_with_jobs failed: ${error.message}`);
  }
  return ((data ?? []) as RpcRow[]).map((r) => ({
    referralId: r.referral_id,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    jobPostingId: r.job_posting_id,
    jobCompanyName: r.job_company_name,
    jobPosition: r.job_position,
    jobLocation: r.job_location,
    jobSalaryMin: r.job_salary_min,
    jobSalaryMax: r.job_salary_max,
    jobEmploymentType: r.job_employment_type,
    status: r.status as SeekerReferralStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export const SEEKER_REFERRAL_STATUS_LABEL: Record<SeekerReferralStatus, string> = {
  planned: "推薦予定",
  recommended: "推薦済",
  screening: "書類選考中",
  interview: "面接中",
  offer: "内定",
  joined: "入社",
  declined: "見送り",
};

export const SEEKER_REFERRAL_STATUS_TONE: Record<SeekerReferralStatus, string> = {
  planned: "bg-muted text-muted-foreground",
  recommended: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  screening: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  interview: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  offer: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  joined: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  declined: "bg-muted text-muted-foreground",
};

/** 「更新されたばかり」(7 日以内)を強調表示するためのフラグ。 */
export function isRecentlyUpdated(updatedAt: string, now: Date = new Date()): boolean {
  const ms = new Date(updatedAt).getTime();
  if (Number.isNaN(ms)) return false;
  return now.getTime() - ms < 7 * 24 * 60 * 60 * 1000;
}
