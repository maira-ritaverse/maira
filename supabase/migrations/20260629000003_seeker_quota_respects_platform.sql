-- =====================================================================
-- get_seeker_quota_for_kind を 改訂:platform_ai_quotas を 優先 する
--
-- 背景:
--   20260629000002 で platform_ai_quotas (Maira 運営 強制上限) を 追加した。
--   エージェント org 経由の seeker (photo_enhance / job_recommendation_seeker)
--   にも 強制上限 が 効く ように、seeker quota RPC も 改訂する。
--
-- 判定:
--   linked な 組織ごとに:
--     1) platform_ai_quotas に レコードあり → その値
--     2) organization_ai_quotas に レコードあり → その値
--     3) どちらも 無し → null (= 既定値)
--   全 linked 組織で 最大の 値 を 採用 (寛大 寄せ)。
--   1 つでも null (既定値 寄り) が あれば 全体 null を 返す (既存挙動と 同じ)。
-- =====================================================================

create or replace function public.get_seeker_quota_for_kind(
  p_kind text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_max_limit int;
  v_has_unbounded boolean;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 各 linked 組織で 「platform 優先 → org 設定 → 既定 null」を coalesce で 求め、
  -- その 最大値を 返す。null (既定値) が ある場合は null を 返して 寛容に 扱う。
  with linked_orgs as (
    select distinct organization_id
    from public.client_records
    where linked_user_id = v_caller_user_id
      and link_status = 'linked'
  ),
  effective as (
    select
      coalesce(p.monthly_limit, o.monthly_limit) as resolved_limit,
      (p.monthly_limit is null and o.monthly_limit is null) as is_unbounded
    from linked_orgs l
    left join public.platform_ai_quotas p
      on p.organization_id = l.organization_id
     and p.kind = p_kind
    left join public.organization_ai_quotas o
      on o.organization_id = l.organization_id
     and o.kind = p_kind
  )
  select
    max(resolved_limit),
    bool_or(is_unbounded)
    into v_max_limit, v_has_unbounded
  from effective;

  if v_has_unbounded then
    return null;
  end if;

  return v_max_limit;
end;
$$;

comment on function public.get_seeker_quota_for_kind(text) is
  '求職者の 紐づき先 組織の AI quota の 最大値を 返す。platform_ai_quotas > organization_ai_quotas > 既定値 の 優先順位 で 評価。';
