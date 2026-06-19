-- =====================================================================
-- 求職者本人が「自分の linked 連携エージェンシーの 1 件 求人」を 全フィールド 引く RPC
--
-- 背景:
--   list_open_jobs_for_seeker は 求人推薦カード用に 8 カラム しか 返さない。
--   Indeed 風 詳細ページ では 18 カラム 全部(法定明示事項 含む)が 必要 だが
--   求職者は organization_id を 持たない ので RLS 越境の SECURITY DEFINER が 要る。
--
-- 設計:
--   ・list_open_jobs_for_seeker と 同じ 認可条件
--     (client_records.linked_user_id = auth.uid() かつ link_status = 'linked')
--   ・open かつ 紐付け先 agency の 求人 のみ 返す
--   ・他組織の 求人は 返らない(認可は WHERE EXISTS で 完結)
--
-- セキュリティ:
--   ・SECURITY DEFINER だが、JOIN + WHERE 条件で 求職者本人の 連携 agency のみに 限定
--   ・revoked / invited / unlinked は 通過しない
-- =====================================================================

create or replace function public.get_job_for_seeker(
  p_job_id uuid
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
  work_change_scope text,
  location_change_scope text,
  smoking_prevention_measure text,
  probation_period text,
  work_hours text,
  break_time text,
  holidays text,
  application_qualifications text,
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
    jp.work_change_scope,
    jp.location_change_scope,
    jp.smoking_prevention_measure,
    jp.probation_period,
    jp.work_hours,
    jp.break_time,
    jp.holidays,
    jp.application_qualifications,
    jp.created_at,
    jp.updated_at
  from public.job_postings jp
  join public.organizations o on o.id = jp.organization_id
  where jp.id = p_job_id
    and jp.status = 'open'
    and exists (
      select 1
      from public.client_records cr
      where cr.organization_id = jp.organization_id
        and cr.linked_user_id = auth.uid()
        and cr.link_status = 'linked'
    )
$$;

comment on function public.get_job_for_seeker(uuid) is
  '求職者本人が、自分が linked された 連携エージェンシーの 単一 open 求人を 18 カラム 全部 取得する RPC。SECURITY DEFINER で RLS を 跨ぐが、認可は WHERE EXISTS で 完結。';

grant execute on function public.get_job_for_seeker(uuid) to authenticated;
