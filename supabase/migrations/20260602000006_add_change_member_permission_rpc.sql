-- ============================================
-- 組織管理基盤(S3):メンバー権限トグル RPC
--
-- change_member_permission(target_member_id, permission_key, granted)
--   1関数で「権限の付与/剥奪 + 監査ログ書き込み」を同一トランザクションで実行する。
--   設計は S2 の change_member_role と同じ流儀:
--     - SECURITY DEFINER + 関数内で「呼び出しユーザー = 同 org の admin」を厳格検証
--     - target が同 org であることを検証
--     - 🔴 target が admin の場合は拒否(admin は常に全権限を持つため、
--       member_permissions に行を作る意味が無い & 混乱の元)
--     - upsert(unique (member_id, permission_key))で1行 1キー
--     - granted=true → action='permission_grant'、false → 'permission_revoke'
--
-- 例外コード:
--   - forbidden     (42501): 権限不足(呼び出し側が admin でない)
--   - not_found     (P0002): target が同 org にいない
--   - target_admin  (P0001): target が admin(トグル不可)
--   - invalid_key   (22023): permission_key が未知
-- ============================================

create or replace function public.change_member_permission(
  target_member_id uuid,
  permission_key text,
  granted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member_id uuid;
  v_caller_role text;
  v_caller_org_id uuid;
  v_target_org_id uuid;
  v_target_role text;
begin
  -- permission_key バリデーション(現状は export のみ。将来追加したら ANY に追記)
  if permission_key not in ('export') then
    raise exception 'invalid_key' using errcode = '22023';
  end if;

  -- 呼び出しユーザーのメンバー情報(RLS バイパスのため直接 SELECT)
  select id, role, organization_id
    into v_caller_member_id, v_caller_role, v_caller_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_caller_member_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- target のメンバー情報(行ロック)
  select role, organization_id
    into v_target_role, v_target_org_id
  from public.organization_members
  where id = target_member_id
  for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_target_org_id <> v_caller_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 🔴 admin に対するトグルは拒否(admin は常に全権限)
  if v_target_role = 'admin' then
    raise exception 'target_admin' using errcode = 'P0001';
  end if;

  -- upsert(unique (member_id, permission_key))
  insert into public.member_permissions (
    organization_id,
    member_id,
    permission_key,
    granted,
    granted_by_member_id,
    updated_at
  ) values (
    v_caller_org_id,
    target_member_id,
    permission_key,
    granted,
    v_caller_member_id,
    now()
  )
  on conflict (member_id, permission_key) do update set
    granted = excluded.granted,
    granted_by_member_id = excluded.granted_by_member_id,
    updated_at = now();

  -- 監査ログ(同一トランザクション)
  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail,
    changed_by_member_id
  ) values (
    v_caller_org_id,
    target_member_id,
    case when granted then 'permission_grant' else 'permission_revoke' end,
    jsonb_build_object('permission_key', permission_key),
    v_caller_member_id
  );
end;
$$;

comment on function public.change_member_permission(uuid, text, boolean) is
  'メンバー権限の付与/剥奪(admin 専用)。'
  '同一トランザクション内で upsert + 監査ログ挿入。'
  'target が admin の場合は target_admin 例外で拒否(admin は常に全権限)。';
