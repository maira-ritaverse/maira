-- =====================================================================
-- 求職者本人が「自分の linked 連携エージェンシーの open 求人」を引く RPC
--
-- 背景:
--   job_postings は organization_id 単位の RLS で、求職者(他組織)は直接
--   select できない。一方、自分が linked された agency の求人は「推薦先」
--   として閲覧したい(seeker-side AI 推薦のため)。
--
-- 設計:
--   ・SECURITY DEFINER で auth.uid() から linked 状態の client_records を引き、
--     その agency の open 求人だけを返す
--   ・revoked / unlinked / invited は対象外
--   ・返り値は最小限(マッチング表示に必要な列のみ)
--
-- セキュリティ:
--   ・他組織の求人や、自分が linked されていない agency の求人は返らない
--   ・clientRecord.linked_user_id = auth.uid() のみが通過条件
-- =====================================================================

create or replace function public.list_open_jobs_for_seeker(
  p_limit integer default 50
)
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  company_name text,
  job_position text,
  employment_type text,
  location text,
  salary_min integer,
  salary_max integer,
  description text,
  required_skills text,
  preferred_skills text,
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
    jp.id,
    jp.organization_id,
    o.name as organization_name,
    jp.company_name,
    jp.position as job_position,
    jp.employment_type,
    jp.location,
    jp.salary_min,
    jp.salary_max,
    jp.description,
    jp.required_skills,
    jp.preferred_skills,
    jp.status,
    jp.created_at,
    jp.updated_at
  from public.job_postings jp
  join public.organizations o on o.id = jp.organization_id
  where jp.status = 'open'
    and exists (
      select 1
      from public.client_records cr
      where cr.organization_id = jp.organization_id
        and cr.linked_user_id = auth.uid()
        and cr.link_status = 'linked'
    )
  order by jp.updated_at desc
  limit p_limit
$$;

comment on function public.list_open_jobs_for_seeker(integer) is
  '求職者本人が、自分が linked された連携エージェンシーの open 求人を取得する RPC。SECURITY DEFINER で RLS を跨ぐが、認可は WHERE EXISTS で完結。';

grant execute on function public.list_open_jobs_for_seeker(integer) to authenticated;
