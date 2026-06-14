-- ============================================
-- fix: get_referral_kpi_by_member の列名あいまいエラーを解消
--
-- 20260614000001_add_kpi_rpc.sql で導入した get_referral_kpi_by_member は、
-- plpgsql の RETURNS TABLE の OUT パラメータ `member_id` と、CTE 内で
-- 同名の列 `member_id` が衝突し、実行時に
--   42702: column reference "member_id" is ambiguous
-- で失敗していた。
--
-- 対応:
--   CTE 内では担当者の列名を `m_id` に改名し、最終 SELECT で OUT 列名
--   `member_id` に詰め替える。これでパラメータ名と列名の名前空間が衝突しない。
--
-- 既存仕様(入力・戻り値・SECURITY DEFINER・組織一致チェック)は不変。
-- ============================================

create or replace function public.get_referral_kpi_by_member(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  member_id        uuid,
  member_name      text,
  member_email     text,
  total_referrals  integer,
  total_placements integer,
  total_interviews integer,
  placement_rate   numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller_org uuid := public.current_user_organization_id();
  v_start timestamptz := p_start_date::timestamptz;
  v_end_exclusive timestamptz := (p_end_date + 1)::timestamptz;
begin
  if v_caller_org is null or v_caller_org <> p_organization_id then
    raise exception 'forbidden: organization mismatch'
      using errcode = '42501';
  end if;

  return query
  with
  -- 紹介(referrals)を期間で絞り、担当者(client_records.assigned_member_id)を付ける
  -- CTE 内の担当者列は OUT パラメータ member_id と衝突しないよう m_id にする
  scoped_referrals as (
    select
      r.id,
      r.status,
      cr.assigned_member_id as m_id
    from public.referrals r
    join public.client_records cr on cr.id = r.client_record_id
    where r.organization_id = p_organization_id
      and r.created_at >= v_start
      and r.created_at <  v_end_exclusive
  ),
  ref_agg as (
    select
      m_id,
      count(*)::integer                                       as total_referrals,
      count(*) filter (where status = 'joined')::integer      as total_placements
    from scoped_referrals
    group by m_id
  ),
  -- 面談遷移も同じ経路で担当者に attribute する
  interview_agg as (
    select
      cr.assigned_member_id as m_id,
      count(*)::integer     as total_interviews
    from public.referral_status_history rsh
    join public.referrals      r  on r.id  = rsh.referral_id
    join public.client_records cr on cr.id = r.client_record_id
    where rsh.organization_id = p_organization_id
      and rsh.to_status = 'interview'
      and rsh.changed_at >= v_start
      and rsh.changed_at <  v_end_exclusive
    group by cr.assigned_member_id
  )
  -- 紹介ゼロでも面談だけある担当者、面談ゼロでも紹介がある担当者、
  -- どちらも拾えるよう FULL OUTER JOIN。NULL 同士(担当者未割当)も
  -- 1 行に集約するため is not distinct from を使う。
  select
    coalesce(ra.m_id, ia.m_id)                  as member_id,
    p.display_name                              as member_name,
    u.email::text                               as member_email,
    coalesce(ra.total_referrals,  0)            as total_referrals,
    coalesce(ra.total_placements, 0)            as total_placements,
    coalesce(ia.total_interviews, 0)            as total_interviews,
    case
      when coalesce(ra.total_referrals, 0) = 0 then null
      else round(
        (coalesce(ra.total_placements, 0)::numeric
         / ra.total_referrals::numeric) * 100, 2
      )
    end                                         as placement_rate
  from ref_agg ra
  full outer join interview_agg ia
    on ia.m_id is not distinct from ra.m_id
  left join public.organization_members om
    on om.id = coalesce(ra.m_id, ia.m_id)
  left join public.profiles p
    on p.id = om.user_id
  left join auth.users u
    on u.id = om.user_id;
end;
$$;

comment on function public.get_referral_kpi_by_member(uuid, date, date) is
  '指定期間 [start, end] (両端含む)の紹介・成約・面談を担当者別に集計して返す。'
  '担当者未割当(assigned_member_id IS NULL)の集計行も含む。'
  '呼び出し元が p_organization_id のメンバーである場合のみ動作。';

revoke all on function public.get_referral_kpi_by_member(uuid, date, date) from public;
grant execute on function public.get_referral_kpi_by_member(uuid, date, date) to authenticated;
