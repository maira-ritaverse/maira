-- =====================================================================
-- 組織管理者向け:組織横断 AI 利用状況サマリ
--
-- 求める情報:
--   ・組織のメンバー全員の今月 AI 利用回数を kind 別に合計
--   ・メンバー別の内訳(name + 各 kind の件数)
--
-- 認可:
--   ・呼び出し者が当該組織の admin であることを検証
--   ・admin でなければ raise exception
--
-- セキュリティ:
--   ・SECURITY DEFINER で ai_usage_events の RLS を跨ぐが、
--     organization_members の admin 判定を最初に行う
-- =====================================================================

create or replace function public.get_org_ai_usage_summary(
  p_month_start timestamptz
)
returns table (
  user_id uuid,
  display_name text,
  email text,
  kind text,
  event_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller uuid;
  v_org_id uuid;
  v_role text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 呼び出し者の組織 + role を確定
  select om.organization_id, om.role
    into v_org_id, v_role
  from public.organization_members om
  where om.user_id = v_caller
  limit 1;

  if v_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;
  if v_role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  return query
  select
    om.user_id,
    coalesce(p.display_name, '(未設定)') as display_name,
    coalesce(au.email, '(non-email)') as email,
    e.kind,
    count(e.id) as event_count
  from public.organization_members om
  left join public.profiles p on p.id = om.user_id
  left join auth.users au on au.id = om.user_id
  left join public.ai_usage_events e
    on e.user_id = om.user_id
   and e.created_at >= p_month_start
  where om.organization_id = v_org_id
  group by om.user_id, p.display_name, au.email, e.kind
  order by display_name nulls last, e.kind;
end;
$$;

comment on function public.get_org_ai_usage_summary(timestamptz) is
  '組織管理者向け:メンバー × kind 別の AI 利用件数を集計する。admin 限定。';

grant execute on function public.get_org_ai_usage_summary(timestamptz) to authenticated;
