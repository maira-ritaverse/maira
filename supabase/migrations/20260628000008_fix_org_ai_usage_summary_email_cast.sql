-- =====================================================================
-- get_org_ai_usage_summary の修正
--
-- 既存定義は email を text 宣言 + auth.users.email を そのまま 返していた。
-- auth.users.email は varchar(255) の Supabase インスタンスがあり、PG の
-- 厳密な型マッチで「structure of query does not match function result type」
-- エラーが 発生する事例が確認された(/agency/settings/ai-usage 表示時)。
--
-- 修正:select 内で auth.users.email を ::text に 明示キャスト。
-- 他の カラムも 同様に text/uuid/bigint で 揃えて 安全側に倒す。
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
    coalesce(p.display_name, '(未設定)')::text as display_name,
    coalesce(au.email::text, '(non-email)') as email,
    e.kind::text,
    count(e.id)::bigint as event_count
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
