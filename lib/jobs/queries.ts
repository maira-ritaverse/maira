/**
 * 求人情報(エージェント企業所有)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業の求人のみが返る。
 * client_records/queries.ts と同じ構造で揃えている。
 */

import { createClient } from "@/lib/supabase/server";
import type { JobPosting } from "./types";

type JobPostingRow = {
  id: string;
  organization_id: string;
  company_name: string;
  position: string;
  employment_type: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  description: string | null;
  required_skills: string | null;
  preferred_skills: string | null;
  status: string;
  // マイグレーション 20260615000004 で追加。
  // ALTER 直後の既存レコードは全て null。
  work_change_scope: string | null;
  location_change_scope: string | null;
  smoking_prevention_measure: string | null;
  probation_period: string | null;
  work_hours: string | null;
  break_time: string | null;
  holidays: string | null;
  application_qualifications: string | null;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

function rowToJobPosting(row: JobPostingRow): JobPosting {
  return {
    id: row.id,
    organizationId: row.organization_id,
    companyName: row.company_name,
    position: row.position,
    employmentType: row.employment_type,
    location: row.location,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    description: row.description,
    requiredSkills: row.required_skills,
    preferredSkills: row.preferred_skills,
    status: row.status as JobPosting["status"],
    workChangeScope: row.work_change_scope,
    locationChangeScope: row.location_change_scope,
    smokingPreventionMeasure: row.smoking_prevention_measure,
    probationPeriod: row.probation_period,
    workHours: row.work_hours,
    breakTime: row.break_time,
    holidays: row.holidays,
    applicationQualifications: row.application_qualifications,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 企業の求人一覧を取得
 * RLS により、自社の求人のみ取得される
 */
export async function listJobPostings(organizationId: string): Promise<JobPosting[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("job_postings")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as JobPostingRow[]).map(rowToJobPosting);
}

/**
 * 単一の求人を取得
 */
export async function getJobPosting(jobId: string): Promise<JobPosting | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("job_postings")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) return null;

  return rowToJobPosting(data as JobPostingRow);
}
