-- =====================================================================
-- 一括割当 RPC (assign / unassign _clients_to_teams_bulk)
--
-- 背景:
--   /api/agency/clients/bulk と /api/agency/clients/[id]/teams PATCH で
--   N clients × M teams の 逐次 RPC 呼び出し が発生していた。
--   途中失敗で中途半端な状態が残る + N×M 往復レイテンシが問題。
--
-- 修正:
--   PL/pgSQL で全ペアを 1 呼び出し 単一トランザクション 内で処理。
--   各ペアの結果を (client_record_id, team_id, operation, applied, reason)
--   のテーブル型で返却。
--     operation = 'add' | 'remove' (呼び出す関数で固定)
--     applied   = true なら INSERT/DELETE が発生
--                 false なら on conflict / 対象なし で no-op
--     reason    = 'ok' | 'forbidden' | 'client_not_found' | 'team_not_found' | 'other'
--
-- 権限:
--   admin OR 主担当 OR team lead の いずれか。 判定は 各 (client, team) 単位。
--
-- 入力サイズ:
--   defense-in-depth で 200 clients × 20 teams を上限に設定 (route 側と同値)。
--
-- 監査ログ:
--   RPC 側では書かない。 route 層で applied=true の 行 をなめて logClientChanges。
--   (eventual consistency 許容の設計判断。RPC 内で書くと SECURITY DEFINER の
--    権限昇格が広がるため回避)。
-- =====================================================================

-- ============================================
-- assign_clients_to_teams_bulk
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

  -- defense-in-depth: 入力配列サイズ 上限
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

      -- 権限判定: admin / 主担当 / team の lead
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

comment on function public.assign_clients_to_teams_bulk(uuid[], uuid[]) is
  '複数顧客を複数リスト表に一括割当。 単一トランザクション内で全ペアの権限判定+INSERT。 '
  '結果テーブル (client_record_id, team_id, operation="add", applied, reason) を返す。';


-- ============================================
-- unassign_clients_from_teams_bulk
-- ============================================
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

comment on function public.unassign_clients_from_teams_bulk(uuid[], uuid[]) is
  '複数顧客のリスト表割当を一括解除。 単一トランザクション内で全ペアの権限判定+DELETE。 '
  '結果テーブル (client_record_id, team_id, operation="remove", applied, reason) を返す。';
