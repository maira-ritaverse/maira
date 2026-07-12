-- ============================================
-- Fix: assign_clients_to_teams_bulk / unassign_clients_from_teams_bulk の
-- 「column reference "client_record_id" is ambiguous」エラーを解消
--
-- 症状(2026-07-12 本番で発生):
--   一括「リスト表に追加」操作で
--   `column reference "client_record_id" is ambiguous` エラー
--   → 500 応答
--
-- 原因:
--   関数の RETURNS TABLE (client_record_id uuid, team_id uuid, ...) が
--   OUT パラメータとして PL/pgSQL の名前空間に入る。
--   INSERT INTO public.client_team_assignments (client_record_id, team_id, ...)
--   や ON CONFLICT (client_record_id, team_id) の解決時に、
--   「OUT パラメータの client_record_id か、テーブルの列 client_record_id か」を
--   PostgreSQL が決定できない(newer PostgreSQL / newer PL/pgSQL で厳格化)。
--
-- 修正:
--   #variable_conflict use_column ディレクティブを本体先頭に追加。
--   これで曖昧なケースはテーブル列を優先する。
--   関数本体の他の変数は全て v_ プレフィックスで衝突しないので副作用なし。
--
--   CREATE OR REPLACE で本体だけ差し替え。返り値の型と署名は変えていないので
--   呼び出し元 (route.ts の BulkRow 型) は変更不要。
-- ============================================

create or replace function public.assign_clients_to_teams_bulk(
  p_client_ids uuid[],
  p_team_ids uuid[]
)
returns table (
  client_record_id uuid,
  team_id uuid,
  operation text,
  applied boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_caller_role text;
  v_client_id uuid;
  v_team_id uuid;
  v_client_org_id uuid;
  v_client_assigned_member_id uuid;
  v_team_org_id uuid;
  v_is_team_lead boolean;
  v_can_assign boolean;
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

  if coalesce(array_length(p_client_ids, 1), 0) > 200 then
    raise exception 'input_size:client_ids' using errcode = '22023';
  end if;
  if coalesce(array_length(p_team_ids, 1), 0) > 20 then
    raise exception 'input_size:team_ids' using errcode = '22023';
  end if;

  select id, role into v_caller_member_id, v_caller_role
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  if v_caller_member_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  foreach v_client_id in array p_client_ids loop
    foreach v_team_id in array p_team_ids loop
      v_can_assign := false;

      select cr.organization_id, cr.assigned_member_id
        into v_client_org_id, v_client_assigned_member_id
        from public.client_records cr
       where cr.id = v_client_id
       limit 1;

      if v_client_org_id is null then
        return query select v_client_id, v_team_id, 'add'::text, false, 'client_not_found'::text;
        continue;
      end if;
      if v_client_org_id <> v_caller_org_id then
        return query select v_client_id, v_team_id, 'add'::text, false, 'client_not_found'::text;
        continue;
      end if;

      select ot.organization_id into v_team_org_id
        from public.organization_teams ot
       where ot.id = v_team_id
       limit 1;

      if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
        return query select v_client_id, v_team_id, 'add'::text, false, 'team_not_found'::text;
        continue;
      end if;

      if v_caller_role = 'admin' then
        v_can_assign := true;
      elsif v_client_assigned_member_id is not distinct from v_caller_member_id then
        v_can_assign := true;
      else
        v_is_team_lead := exists (
          select 1 from public.organization_team_members otm
           where otm.team_id = v_team_id
             and otm.member_id = v_caller_member_id
             and otm.role = 'lead'
        );
        if v_is_team_lead then v_can_assign := true; end if;
      end if;

      if not v_can_assign then
        return query select v_client_id, v_team_id, 'add'::text, false, 'forbidden'::text;
        continue;
      end if;

      insert into public.client_team_assignments (
        client_record_id, team_id, assigned_by_member_id
      ) values (
        v_client_id, v_team_id, v_caller_member_id
      )
      on conflict (client_record_id, team_id) do nothing;

      get diagnostics v_row_count = row_count;
      return query select v_client_id, v_team_id, 'add'::text, v_row_count > 0, 'ok'::text;
    end loop;
  end loop;

  return;
end;
$$;


create or replace function public.unassign_clients_from_teams_bulk(
  p_client_ids uuid[],
  p_team_ids uuid[]
)
returns table (
  client_record_id uuid,
  team_id uuid,
  operation text,
  applied boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_caller_role text;
  v_client_id uuid;
  v_team_id uuid;
  v_client_org_id uuid;
  v_client_assigned_member_id uuid;
  v_team_org_id uuid;
  v_is_team_lead boolean;
  v_can_unassign boolean;
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

  if coalesce(array_length(p_client_ids, 1), 0) > 200 then
    raise exception 'input_size:client_ids' using errcode = '22023';
  end if;
  if coalesce(array_length(p_team_ids, 1), 0) > 20 then
    raise exception 'input_size:team_ids' using errcode = '22023';
  end if;

  select id, role into v_caller_member_id, v_caller_role
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  if v_caller_member_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  foreach v_client_id in array p_client_ids loop
    foreach v_team_id in array p_team_ids loop
      v_can_unassign := false;

      select cr.organization_id, cr.assigned_member_id
        into v_client_org_id, v_client_assigned_member_id
        from public.client_records cr
       where cr.id = v_client_id
       limit 1;

      if v_client_org_id is null then
        return query select v_client_id, v_team_id, 'remove'::text, false, 'client_not_found'::text;
        continue;
      end if;
      if v_client_org_id <> v_caller_org_id then
        return query select v_client_id, v_team_id, 'remove'::text, false, 'client_not_found'::text;
        continue;
      end if;

      select ot.organization_id into v_team_org_id
        from public.organization_teams ot
       where ot.id = v_team_id
       limit 1;

      if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
        return query select v_client_id, v_team_id, 'remove'::text, false, 'team_not_found'::text;
        continue;
      end if;

      if v_caller_role = 'admin' then
        v_can_unassign := true;
      elsif v_client_assigned_member_id is not distinct from v_caller_member_id then
        v_can_unassign := true;
      else
        v_is_team_lead := exists (
          select 1 from public.organization_team_members otm
           where otm.team_id = v_team_id
             and otm.member_id = v_caller_member_id
             and otm.role = 'lead'
        );
        if v_is_team_lead then v_can_unassign := true; end if;
      end if;

      if not v_can_unassign then
        return query select v_client_id, v_team_id, 'remove'::text, false, 'forbidden'::text;
        continue;
      end if;

      delete from public.client_team_assignments cta
       where cta.client_record_id = v_client_id
         and cta.team_id = v_team_id;

      get diagnostics v_row_count = row_count;
      return query select v_client_id, v_team_id, 'remove'::text, v_row_count > 0, 'ok'::text;
    end loop;
  end loop;

  return;
end;
$$;

-- GRANT は 20260712000016 で付与済みなので再付与不要(CREATE OR REPLACE で権限は保持される)。
