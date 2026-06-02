-- ============================================
-- 組織管理基盤(S2):メンバー一覧 + role 変更
--
-- 2つの SECURITY DEFINER 関数を追加する。
--
-- 1. list_organization_members_with_meta(org_id)
--      メンバー一覧(member_id / user_id / role / display_name / email / created_at)を返す。
--      email は auth.users にあり通常クエリでは取れないため SECURITY DEFINER で公開。
--      呼び出し元が同 org のメンバーである場合のみ行を返す(テナント分離維持)。
--
-- 2. change_member_role(target_member_id, new_role)
--      role 変更を「最後の admin チェック + 監査ログ書き込み」と原子的に行う。
--      🔴 最重要:admin → advisor に降格する時、org に admin が0人になるなら拒否する。
--      自分自身を含めて、最後の1人の admin は誰も advisor に落とせない。
--
-- どちらも SECURITY DEFINER なので、関数内で auth.uid() と引数 org_id の整合性を
-- 厳格にチェックする(呼び出し側 RLS だけに依存しない二重防御)。
-- ============================================

-- ============================================
-- 1. list_organization_members_with_meta
-- ============================================
create or replace function public.list_organization_members_with_meta(
  target_organization_id uuid
)
returns table (
  member_id uuid,
  user_id uuid,
  role text,
  display_name text,
  email text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    om.id as member_id,
    om.user_id,
    om.role,
    p.display_name,
    u.email::text as email,
    om.created_at
  from public.organization_members om
  left join public.profiles p on p.id = om.user_id
  left join auth.users u on u.id = om.user_id
  where om.organization_id = target_organization_id
    -- 呼び出し元が同じ組織のメンバーである場合のみ返す
    and target_organization_id = public.current_user_organization_id();
$$;

comment on function public.list_organization_members_with_meta(uuid) is
  '指定組織のメンバー一覧 (member_id, user_id, role, display_name, email, created_at)。'
  '呼び出し元が同組織メンバーでない場合は 0 件。'
  'auth.users.email を安全に同 org 内でのみ公開するためのヘルパー。';

-- ============================================
-- 2. change_member_role(target_member_id, new_role)
-- ============================================
-- 設計:
--   - SECURITY DEFINER で実行(RLS バイパス)
--   - 関数内で「呼び出しユーザー = 同 org の admin」を厳格に検証
--   - target も同 org であることを検証
--   - 🔴 admin → advisor の時のみ「最後の1人の admin を降格しようとしていないか」を検証
--   - 同一トランザクション内で role 更新 + member_audit_log 挿入(原子性)
--   - 検証失敗時は raise exception(ロールバック)
--
-- 例外は SQLSTATE で分岐できるように MESSAGE と HINT を使い分ける:
--   - 'last_admin'  : 最後の1人 admin の降格(API 側で 400 にして優しいメッセージ)
--   - 'forbidden'   : 権限不足(API 側で 403)
--   - 'invalid_role': role の値不正(API 側で 400)
--   - 'not_found'   : target が同 org にいない(API 側で 404)

create or replace function public.change_member_role(
  target_member_id uuid,
  new_role text
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
  v_remaining_admins int;
begin
  -- new_role バリデーション
  if new_role not in ('admin', 'advisor') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  -- 呼び出しユーザーのメンバー情報を取得(RLS バイパスのため直接 SELECT)
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

  -- target のメンバー情報を取得(行ロックで last-admin 判定の競合を防ぐ)
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

  -- 変更不要(現 role と同じ)なら何もしない(監査ログも残さない)
  if v_target_role = new_role then
    return;
  end if;

  -- 🔴 最後の admin チェック:
  --   target が admin で、new_role が advisor の場合のみ確認。
  --   org 内の admin 数から target を除いた残りが 0 なら拒否。
  if v_target_role = 'admin' and new_role = 'advisor' then
    select count(*)
      into v_remaining_admins
    from public.organization_members
    where organization_id = v_caller_org_id
      and role = 'admin'
      and id <> target_member_id;

    if v_remaining_admins = 0 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  -- role を更新
  update public.organization_members
  set role = new_role
  where id = target_member_id;

  -- 監査ログを挿入(同一トランザクション)
  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail,
    changed_by_member_id
  ) values (
    v_caller_org_id,
    target_member_id,
    'role_change',
    jsonb_build_object('from', v_target_role, 'to', new_role),
    v_caller_member_id
  );
end;
$$;

comment on function public.change_member_role(uuid, text) is
  'メンバーの role を変更する(admin 専用)。'
  '同一トランザクション内で last-admin 検証 + role 更新 + 監査ログ挿入を行う。'
  '最後の1人の admin を advisor に降格しようとした場合は last_admin 例外で拒否。';
