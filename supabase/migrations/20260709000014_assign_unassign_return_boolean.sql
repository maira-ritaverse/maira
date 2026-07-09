-- =====================================================================
-- assign_client_to_team / unassign_client_from_team を returns boolean に変更
--
-- 背景:
--   現在の RPC は returns void で、 呼び出し元は「実際に INSERT / DELETE が
--   発生したか」 と 「on conflict do nothing で スキップされたか」 を区別できない。
--   このため bulk route の 監査ログに 「実質変更なし」 の 行 も 追記される。
--
-- 修正:
--   INSERT / DELETE の 影響行数を GET DIAGNOSTICS で取得し、 変化があったら
--   true、 なかったら false を返す。 呼び出し元 は data === true の場合のみ
--   監査ログを push する運用に。
--
-- 注意:
--   returns 型 の 変更は create or replace では できない (drop → create)。
--   短時間 の DROP → CREATE の 間 に 呼び出し が 来ると 一時的 に エラー が
--   発生する 可能性 が あるため、 デプロイは 低トラフィック時間帯 を 推奨。
--
--   セマンティクス:
--     - 権限 拒否 / 存在 しない 等 は 引き続き raise exception (現行維持)
--     - INSERT / DELETE の 影響 0 行 (重複 / 存在 なし) は false を 返す (audit skip)
-- =====================================================================

-- ============================================
-- assign_client_to_team returns boolean
-- ============================================
drop function if exists public.assign_client_to_team(uuid, uuid);

create function public.assign_client_to_team(
  p_client_record_id uuid,
  p_team_id uuid
)
returns boolean
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
  v_row_count int;
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

  insert into public.client_team_assignments (
    client_record_id, team_id, assigned_by_member_id
  ) values (
    p_client_record_id, p_team_id, v_caller_member_id
  )
  on conflict (client_record_id, team_id) do nothing;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

comment on function public.assign_client_to_team(uuid, uuid) is
  '顧客を team に割当 (admin / 主担当 / team lead)。 実際に INSERT された場合 true、'
  ' 既に割当済で on conflict でスキップされた場合 false を返す。';


-- ============================================
-- unassign_client_from_team returns boolean
-- ============================================
drop function if exists public.unassign_client_from_team(uuid, uuid);

create function public.unassign_client_from_team(
  p_client_record_id uuid,
  p_team_id uuid
)
returns boolean
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
  v_row_count int;
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

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

comment on function public.unassign_client_from_team(uuid, uuid) is
  '顧客の team 割当を解除。 実際に DELETE された場合 true、 対象がなくスキップ '
  'された場合 false を返す。';
