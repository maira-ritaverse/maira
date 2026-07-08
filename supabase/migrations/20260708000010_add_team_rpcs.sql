-- =====================================================================
-- team 管理 の SECURITY DEFINER RPC
--
-- 直接 の INSERT / UPDATE / DELETE を RLS で 禁止 し、 権限 チェック 込 みの
-- RPC 経由 で のみ 変更 可能 に する。
-- =====================================================================

-- ============================================
-- create_team: admin のみ
-- ============================================
create or replace function public.create_team(
  p_name text,
  p_description text default null,
  p_color text default null,
  p_sort_order int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_new_id uuid;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- admin 判定 + member_id 取得
  select id into v_caller_member_id
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
    and role = 'admin'
  limit 1;

  if v_caller_member_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  insert into public.organization_teams (
    organization_id, name, description, color, sort_order, created_by_member_id
  ) values (
    v_caller_org_id,
    trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''),
    p_color,
    coalesce(p_sort_order, 0),
    v_caller_member_id
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

comment on function public.create_team(text, text, text, int) is
  '組織 admin が team を 作成 する。 同 org 内 で name は unique。';


-- ============================================
-- update_team: admin のみ
-- ============================================
create or replace function public.update_team(
  p_team_id uuid,
  p_name text default null,
  p_description text default null,
  p_color text default null,
  p_sort_order int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_team_org_id uuid;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_members
    where user_id = v_caller_user_id
      and organization_id = v_caller_org_id
      and role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select organization_id into v_team_org_id
  from public.organization_teams
  where id = p_team_id
  for update;

  if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.organization_teams
  set
    name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
    description = case
      when p_description is null then description
      else nullif(trim(p_description), '')
    end,
    color = coalesce(p_color, color),
    sort_order = coalesce(p_sort_order, sort_order),
    updated_at = now()
  where id = p_team_id
    and organization_id = v_caller_org_id;
end;
$$;

comment on function public.update_team(uuid, text, text, text, int) is
  '組織 admin が team の 属性 を 更新 する。';


-- ============================================
-- delete_team: admin のみ、 関連 assignments は cascade で 消える
-- ============================================
create or replace function public.delete_team(
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_team_org_id uuid;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_members
    where user_id = v_caller_user_id
      and organization_id = v_caller_org_id
      and role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select organization_id into v_team_org_id
  from public.organization_teams
  where id = p_team_id;

  if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  delete from public.organization_teams
  where id = p_team_id
    and organization_id = v_caller_org_id;
end;
$$;

comment on function public.delete_team(uuid) is
  '組織 admin が team を 削除。 関連 team_members / client_assignments は cascade。';


-- ============================================
-- set_team_member: admin のみ、 upsert (add or update role)
-- ============================================
create or replace function public.set_team_member(
  p_team_id uuid,
  p_member_id uuid,
  p_role text default 'member'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_team_org_id uuid;
  v_member_org_id uuid;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_caller_member_id
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
    and role = 'admin'
  limit 1;

  if v_caller_member_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_role not in ('member', 'lead') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  select organization_id into v_team_org_id
  from public.organization_teams where id = p_team_id;
  if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select organization_id into v_member_org_id
  from public.organization_members where id = p_member_id;
  if v_member_org_id is null or v_member_org_id <> v_caller_org_id then
    raise exception 'member_not_in_org' using errcode = 'P0001';
  end if;

  insert into public.organization_team_members (
    team_id, member_id, role, added_by_member_id
  ) values (
    p_team_id, p_member_id, p_role, v_caller_member_id
  )
  on conflict (team_id, member_id) do update
    set role = excluded.role;
end;
$$;

comment on function public.set_team_member(uuid, uuid, text) is
  '組織 admin が team に member を 追加 / 役割 変更。 upsert。';


-- ============================================
-- remove_team_member: admin のみ
-- ============================================
create or replace function public.remove_team_member(
  p_team_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_team_org_id uuid;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_members
    where user_id = v_caller_user_id
      and organization_id = v_caller_org_id
      and role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select organization_id into v_team_org_id
  from public.organization_teams where id = p_team_id;
  if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  delete from public.organization_team_members
  where team_id = p_team_id and member_id = p_member_id;
end;
$$;


-- ============================================
-- assign_client_to_team: admin / 主担当 / team lead が 割当 可能
-- ============================================
create or replace function public.assign_client_to_team(
  p_client_record_id uuid,
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_caller_role text;
  v_client_org_id uuid;
  v_client_assigned_member_id uuid;
  v_team_org_id uuid;
  v_is_team_lead boolean;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, role into v_caller_member_id, v_caller_role
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  if v_caller_member_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select organization_id, assigned_member_id
  into v_client_org_id, v_client_assigned_member_id
  from public.client_records where id = p_client_record_id;
  if v_client_org_id is null or v_client_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select organization_id into v_team_org_id
  from public.organization_teams where id = p_team_id;
  if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 権限 判定: admin / 主 担当 / team の lead の いずれ か
  v_is_team_lead := exists (
    select 1 from public.organization_team_members
    where team_id = p_team_id
      and member_id = v_caller_member_id
      and role = 'lead'
  );

  if v_caller_role <> 'admin'
     and v_client_assigned_member_id is distinct from v_caller_member_id
     and not v_is_team_lead then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.client_team_assignments (
    client_record_id, team_id, assigned_by_member_id
  ) values (
    p_client_record_id, p_team_id, v_caller_member_id
  )
  on conflict (client_record_id, team_id) do nothing;
end;
$$;

comment on function public.assign_client_to_team(uuid, uuid) is
  '顧客 を team に 割当 (admin / 主担当 / team lead)。 upsert (重複 は 無視)。';


-- ============================================
-- unassign_client_from_team: 同 権限 で 解除
-- ============================================
create or replace function public.unassign_client_from_team(
  p_client_record_id uuid,
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_caller_role text;
  v_client_org_id uuid;
  v_client_assigned_member_id uuid;
  v_team_org_id uuid;
  v_is_team_lead boolean;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, role into v_caller_member_id, v_caller_role
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  if v_caller_member_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select organization_id, assigned_member_id
  into v_client_org_id, v_client_assigned_member_id
  from public.client_records where id = p_client_record_id;
  if v_client_org_id is null or v_client_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select organization_id into v_team_org_id
  from public.organization_teams where id = p_team_id;
  if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_is_team_lead := exists (
    select 1 from public.organization_team_members
    where team_id = p_team_id
      and member_id = v_caller_member_id
      and role = 'lead'
  );

  if v_caller_role <> 'admin'
     and v_client_assigned_member_id is distinct from v_caller_member_id
     and not v_is_team_lead then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.client_team_assignments
  where client_record_id = p_client_record_id
    and team_id = p_team_id;
end;
$$;
