-- 「column reference "permission_key" is ambiguous」 エラー の 修正。
--
-- change_member_permission(uuid, text, boolean) の 第 2 引数 名 が
-- member_permissions テーブル の permission_key 列 と 衝突 し、
-- ON CONFLICT 句 で PostgreSQL が 列 か 変数 か を 決定 できず ambiguous 例外
-- を 投げて いた。
--
-- 引数 名 を p_permission_key に リネーム し 衝突 を 解消。 戻り 値 / 型 /
-- 動作 は 既存 と 完全 互換 (= シグネチャ は同じ uuid, text, boolean)。
-- クライアント の rpc 呼び出し は permission_key → p_permission_key に 同 期 更新 が 必要。

-- CREATE OR REPLACE では 引数 名 変更 不可 (= cannot change name of input parameter)
-- ため、 一度 DROP してから 作り直す。
drop function if exists public.change_member_permission(uuid, text, boolean);

create function public.change_member_permission(
  target_member_id uuid,
  p_permission_key text,
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
  -- 現状は export のみ。 将来 追加 したら IN リスト に 追記
  if p_permission_key not in ('export') then
    raise exception 'invalid_key' using errcode = '22023';
  end if;

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

  -- admin は 常 に 全 権限 を 持つ ため、 トグル 不可
  if v_target_role = 'admin' then
    raise exception 'target_admin' using errcode = 'P0001';
  end if;

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
    p_permission_key,
    granted,
    v_caller_member_id,
    now()
  )
  on conflict (member_id, permission_key) do update set
    granted = excluded.granted,
    granted_by_member_id = excluded.granted_by_member_id,
    updated_at = now();

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
    jsonb_build_object('permission_key', p_permission_key),
    v_caller_member_id
  );
end;
$$;
