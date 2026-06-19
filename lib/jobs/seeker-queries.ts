/**
 * 求職者(seeker)用 求人 取得ヘルパ
 *
 * 求職者は organization_id を 持たない ため、 job_postings へは 直接 RLS が
 * 通らない。代わりに SECURITY DEFINER RPC(get_job_for_seeker)を 経由する。
 *
 * RPC 側で 「自分が linked 済み の 連携 agency の open 求人」のみを 返すよう
 * 認可を かけている(他 agency / closed / paused は 返らない)。
 */
import { createClient } from "@/lib/supabase/server";
import type { JobPosting } from "./types";

export type SeekerJobDetail = JobPosting & {
  organizationName: string;
};

type SeekerJobRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  company_name: string;
  job_position: string;
  employment_type: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  description: string | null;
  required_skills: string | null;
  preferred_skills: string | null;
  status: string;
  work_change_scope: string | null;
  location_change_scope: string | null;
  smoking_prevention_measure: string | null;
  probation_period: string | null;
  work_hours: string | null;
  break_time: string | null;
  holidays: string | null;
  application_qualifications: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 求職者本人が 自分の 連携 agency の 単一 open 求人を 取得する。
 * 該当なし or 認可なし は null(呼出側で 404 / notFound に 倒す)。
 */
export async function getJobForSeeker(jobId: string): Promise<SeekerJobDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_job_for_seeker", { p_job_id: jobId });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as SeekerJobRow;
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    companyName: row.company_name,
    position: row.job_position,
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
    createdByMemberId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
