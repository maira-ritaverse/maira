-- ============================================
-- fix: get_referral_kpi_by_member の FULL OUTER JOIN を実行可能にする
--
-- 20260614000002 で OUT パラメータとの名前衝突は解消したが、
-- FULL OUTER JOIN ... ON ia.m_id IS NOT DISTINCT FROM ra.m_id
-- が Postgres の制約
--   0A000: FULL JOIN is only supported with merge-joinable or
--          hash-joinable join conditions
-- に抵触して実行できなかった。IS NOT DISTINCT FROM は FULL JOIN では
-- 利用できない(LEFT JOIN は OK)。
--
-- 対応:
--   担当者未割当(client_records.assigned_member_id IS NULL)を「1 つの
--   集計行」にまとめる要件は維持しつつ、CTE 段階で NULL を sentinel UUID
--   (全ゼロ)に置換し、FULL OUTER JOIN は通常の等価 `=` で結合する。
--   等価結合ならハッシュ結合できるので上記の制約に引っかからない。
--   最終 SELECT で sentinel を NULLIF で NULL に戻し、戻り値の意味も維持する。
--
-- 既存仕様(入力・戻り値・SECURITY DEFINER・組織一致チェック・
-- 担当者未割当行を含める)は不変。
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
  -- 担当者未割当を 1 行に集約するための sentinel(全ゼロ UUID)。
  -- 実在ユーザーと衝突しないよう FULL ZERO を使う。
  c_unassigned constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  if v_caller_org is null or v_caller_org <> p_organization_id then
    raise exception 'forbidden: organization mismatch'
      using errcode = '42501';
  end if;

  return query
  with
  -- 紹介(referrals)を期間で絞り、担当者(client_records.assigned_member_id)を付ける
  -- NULL を sentinel に置換しておくと、後段の FULL OUTER JOIN を等価 `=` で書ける
  scoped_referrals as (
    select
      r.id,
      r.status,
      coalesce(cr.assigned_member_id, c_unassigned) as m_id
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
      coalesce(cr.assigned_member_id, c_unassigned) as m_id,
      count(*)::integer                              as total_interviews
    from public.referral_status_history rsh
    join public.referrals      r  on r.id  = rsh.referral_id
    join public.client_records cr on cr.id = r.client_record_id
    where rsh.organization_id = p_organization_id
      and rsh.to_status = 'interview'
      and rsh.changed_at >= v_start
      and rsh.changed_at <  v_end_exclusive
    group by coalesce(cr.assigned_member_id, c_unassigned)
  )
  -- 紹介ゼロでも面談だけある担当者、面談ゼロでも紹介がある担当者の
  -- どちらも拾えるよう FULL OUTER JOIN。等価結合なのでハッシュ結合可。
  select
    nullif(coalesce(ra.m_id, ia.m_id), c_unassigned)  as member_id,
    p.display_name                                    as member_name,
    u.email::text                                     as member_email,
    coalesce(ra.total_referrals,  0)                  as total_referrals,
    coalesce(ra.total_placements, 0)                  as total_placements,
    coalesce(ia.total_interviews, 0)                  as total_interviews,
    case
      when coalesce(ra.total_referrals, 0) = 0 then null
      else round(
        (coalesce(ra.total_placements, 0)::numeric
         / ra.total_referrals::numeric) * 100, 2
      )
    end                                               as placement_rate
  from ref_agg ra
  full outer join interview_agg ia
    on ia.m_id = ra.m_id
  -- 担当者未割当行(m_id = sentinel)は om/p/u を全て NULL にしたいので
  -- nullif でジョインキーを NULL 化する(NULL との等価は常に NULL ≒ false)。
  left join public.organization_members om
    on om.id = nullif(coalesce(ra.m_id, ia.m_id), c_unassigned)
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
