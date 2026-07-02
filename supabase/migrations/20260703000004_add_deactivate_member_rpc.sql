-- =====================================================================
-- deactivate_member RPC — メンバー 削除 の 集約 ロジック
--
-- 目的:
--   ・「メンバー 削除 route」 (/api/agency/members/[id] DELETE) が 呼ぶ
--   ・SECURITY DEFINER で 「同 組織 admin だけ が 削除 可」 を 強制
--   ・「最後 の admin」 を 削除 しよう と した ら 拒否 (組織 が admin 不在 に
--     なる の を 防止、 既存 change_member_role RPC と 同じ ポリシー)
--   ・削除 の 監査 ログ を member_audit_log に 残す
--   ・呼び出し 側 は 削除 成功 直後 に syncOrganizationSeatCount を 呼び、
--     Stripe subscription の Extra Seat quantity を 追従 させる
--
-- 例外 コード:
--   ・unauthenticated (42501): 未 ログイン
--   ・not_org_member (42501): 呼び出し 側 が 組織 メンバー でない
--   ・forbidden (42501): admin でない、 or 別 組織 メンバー を 削除 しよう と した
--   ・not_found (P0002): target が 存在 しない
--   ・last_admin (P0001): 最後 の admin を 削除 しよう と した
-- =====================================================================

create or replace function public.deactivate_member(
  target_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_caller_member_id uuid;
  v_target_role text;
  v_target_org_id uuid;
  v_admin_count int;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  -- 呼び出し 側 は admin だけ 削除 可
  select role, id into v_caller_role, v_caller_member_id
    from public.organization_members
   where user_id = v_caller_user_id
     and organization_id = v_caller_org_id
   limit 1;

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 対象 メンバー を FOR UPDATE で ロック
  select role, organization_id into v_target_role, v_target_org_id
    from public.organization_members
   where id = target_member_id
   for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 別 org の 人 は 触ら せない (RLS 二重 防御)
  if v_target_org_id <> v_caller_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 最後 の admin は 削除 拒否
  if v_target_role = 'admin' then
    select count(*) into v_admin_count
      from public.organization_members
     where organization_id = v_caller_org_id
       and role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  -- 削除 (関連 FK は on delete cascade / set null で 掃除 済)
  delete from public.organization_members where id = target_member_id;

  -- 監査 ログ
  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    changed_by_member_id,
    detail
  ) values (
    v_caller_org_id,
    target_member_id,
    'member_removed',
    v_caller_member_id,
    jsonb_build_object('removed_role', v_target_role)
  );

  return target_member_id;
end;
$$;

comment on function public.deactivate_member(uuid) is
  'メンバー 削除 の 集約 RPC。 同 組織 admin 限定、 最後 の admin は 削除 不可、 監査 ログ を 残す。';

-- 認証 済 ユーザー が 実行 可能 (SECURITY DEFINER 内 で 権限 検証)
grant execute on function public.deactivate_member(uuid) to authenticated;
