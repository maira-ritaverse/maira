-- ============================================
-- KPI集計 RPC: 紹介・成約・面談の集計
--
-- エージェント向け KPI ダッシュボード用に、期間内の
--   - 紹介(referrals)件数
--   - 成約(referrals.status='joined')件数
--   - 面談遷移(referral_status_history.to_status='interview')回数
--   - 成約率(placement_rate)
-- を集計する関数を 2 本提供する。
--
-- 1) get_referral_kpi_summary(org_id, start, end)        → JSON 1 行
-- 2) get_referral_kpi_by_member(org_id, start, end)      → 担当者ごとに 1 行
--
-- ───────────────────────────────────────────────
-- セキュリティ:
--   SECURITY DEFINER で実行する。RLS をバイパスする代わりに、関数冒頭で
--     p_organization_id = public.current_user_organization_id()
--   を強制し、呼び出し元は「自分の所属組織の ID しか指定できない」状態を保つ。
--   担当者別版は profiles と auth.users を参照するため、いずれにせよ
--   SECURITY DEFINER が必須(profiles の RLS は自分のみ閲覧可、
--   auth.users は通常ユーザーから参照不可)。
--
-- ───────────────────────────────────────────────
-- 日付境界(「この日を含む」):
--   created_at / changed_at は timestamptz、p_end_date は DATE。
--   created_at <= p_end_date と書くと p_end_date の 00:00:00 までしか
--   拾えず当日分が落ちるため、ここでは
--     [p_start_date 00:00:00, p_end_date + 1 day 00:00:00)
--   の半開区間で扱う。サーバータイムゾーン(Supabase は UTC)基準。
--
-- ───────────────────────────────────────────────
-- 担当者の attribution(担当者別版):
--   referrals 自体に担当者カラムはない。クライアントを企業内で誰が
--   抱えているかは client_records.assigned_member_id が正なので、
--     referrals → client_records → assigned_member_id
--   で「その紹介の担当者」を導出する。
--   面談遷移(referral_status_history)も同じ経路で担当者に帰属させる。
--   担当者未割当(assigned_member_id IS NULL)の集計行も返す。
-- ============================================


-- ============================================
-- 1) サマリ版
-- ============================================
create or replace function public.get_referral_kpi_summary(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date
)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller_org uuid := public.current_user_organization_id();
  v_start timestamptz := p_start_date::timestamptz;
  v_end_exclusive timestamptz := (p_end_date + 1)::timestamptz;
  v_total_referrals integer := 0;
  v_total_placements integer := 0;
  v_total_interviews integer := 0;
begin
  -- テナント分離:呼び出し元の所属組織と一致しなければ拒否
  -- (SECURITY DEFINER なので RLS では止められない。ここで明示チェック)
  if v_caller_org is null or v_caller_org <> p_organization_id then
    raise exception 'forbidden: organization mismatch'
      using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'joined')::integer
  into v_total_referrals, v_total_placements
  from public.referrals
  where organization_id = p_organization_id
    and created_at >= v_start
    and created_at <  v_end_exclusive;

  select count(*)::integer
  into v_total_interviews
  from public.referral_status_history
  where organization_id = p_organization_id
    and to_status = 'interview'
    and changed_at >= v_start
    and changed_at <  v_end_exclusive;

  return json_build_object(
    'total_referrals',  v_total_referrals,
    'total_placements', v_total_placements,
    'total_interviews', v_total_interviews,
    'placement_rate',
      case
        when v_total_referrals = 0 then null
        else round(
          (v_total_placements::numeric / v_total_referrals::numeric) * 100, 2
        )
      end,
    'start_date', p_start_date,
    'end_date',   p_end_date
  );
end;
$$;

comment on function public.get_referral_kpi_summary(uuid, date, date) is
  '指定期間 [start, end] (両端含む)の紹介・成約・面談を集計し JSON で返す。'
  '呼び出し元が p_organization_id のメンバーである場合のみ動作。';

-- 既定の public 実行権限を絞り、authenticated ロールにだけ与える
revoke all on function public.get_referral_kpi_summary(uuid, date, date) from public;
grant execute on function public.get_referral_kpi_summary(uuid, date, date) to authenticated;


-- ============================================
-- 2) 担当者別版
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
  scoped_referrals as (
    select
      r.id,
      r.status,
      cr.assigned_member_id as member_id
    from public.referrals r
    join public.client_records cr on cr.id = r.client_record_id
    where r.organization_id = p_organization_id
      and r.created_at >= v_start
      and r.created_at <  v_end_exclusive
  ),
  ref_agg as (
    select
      member_id,
      count(*)::integer                                       as total_referrals,
      count(*) filter (where status = 'joined')::integer      as total_placements
    from scoped_referrals
    group by member_id
  ),
  -- 面談遷移も同じ経路で担当者に attribute する
  interview_agg as (
    select
      cr.assigned_member_id as member_id,
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
    coalesce(ra.member_id, ia.member_id)        as member_id,
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
    on ia.member_id is not distinct from ra.member_id
  left join public.organization_members om
    on om.id = coalesce(ra.member_id, ia.member_id)
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
