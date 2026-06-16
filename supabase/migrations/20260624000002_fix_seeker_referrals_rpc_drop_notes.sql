-- =====================================================================
-- プライバシー修正:list_seeker_referrals_with_jobs から notes 列を除く
--
-- 背景:
--   ・referrals.notes はエージェント側の内部メモ(「なぜ推薦するか」の率直な
--     アセスメントなど)。求職者本人に直接見せるのは不適切。
--   ・直前のマイグレーション 20260624000001 で誤って exposure していたため、
--     関数を DROP → CREATE し直して notes を返さないようにする。
--   ・create or replace では戻り型を変更できない(SQLSTATE 42P13)ため DROP 必須。
-- =====================================================================

drop function if exists public.list_seeker_referrals_with_jobs();

create function public.list_seeker_referrals_with_jobs()
returns table (
  referral_id uuid,
  organization_id uuid,
  organization_name text,
  client_record_id uuid,
  job_posting_id uuid,
  job_company_name text,
  job_position text,
  job_location text,
  job_salary_min integer,
  job_salary_max integer,
  job_employment_type text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id              as referral_id,
    r.organization_id,
    o.name            as organization_name,
    r.client_record_id,
    r.job_posting_id,
    jp.company_name   as job_company_name,
    jp.position       as job_position,
    jp.location       as job_location,
    jp.salary_min     as job_salary_min,
    jp.salary_max     as job_salary_max,
    jp.employment_type as job_employment_type,
    r.status,
    r.created_at,
    r.updated_at
  from public.referrals r
  join public.client_records cr
    on cr.id = r.client_record_id
   and cr.linked_user_id = auth.uid()
   and cr.link_status = 'linked'
  join public.organizations o on o.id = r.organization_id
  join public.job_postings jp on jp.id = r.job_posting_id
  order by r.updated_at desc
$$;

grant execute on function public.list_seeker_referrals_with_jobs() to authenticated;
