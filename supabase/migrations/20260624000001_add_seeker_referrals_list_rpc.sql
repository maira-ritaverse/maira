-- =====================================================================
-- 求職者本人が「自分が linked された agency が進めている referrals」を見る RPC
--
-- 背景:
--   ・referrals テーブルは org メンバー専用 RLS。求職者(別 auth.users)からは
--     直接 select できない
--   ・しかし「エージェントが自分のために何を推進しているか」は本人に開示すべき情報
--     (応募依頼を出した結果どうなったか、選考が進んでいるか等)
--
-- 設計:
--   ・SECURITY DEFINER で client_records.linked_user_id = auth.uid() を検証
--   ・linked 状態の referrals のみ取得(revoked / unlinked は除外)
--   ・求人 + agency 名も join して 1 回で取得
-- =====================================================================

create or replace function public.list_seeker_referrals_with_jobs()
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
  notes text,
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
    r.notes,
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

comment on function public.list_seeker_referrals_with_jobs() is
  '求職者本人視点で、自分が linked された agency の referrals を job + agency 名付きで一覧する。';

grant execute on function public.list_seeker_referrals_with_jobs() to authenticated;
