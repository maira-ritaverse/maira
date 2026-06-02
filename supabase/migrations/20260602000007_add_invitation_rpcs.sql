-- ============================================
-- 組織管理基盤(S4):招待の発行 / 取消 RPC
--
-- 追加内容:
--   1. member_audit_log.target_member_id を nullable に変更
--      → 招待アクション(invitation_sent / invitation_revoked)は対象メンバーが
--        まだ存在しない or 既に削除されているため、target を持てないことがある。
--   2. issue_invitation(email, role, token, expires_at)
--      - admin 専用、同 org スコープ
--      - 「同 email が自 org の既存メンバー」なら拒否
--      - 同 email・同 org の pending 招待が既にあれば revoke して再発行
--      - organization_invitations に insert + member_audit_log に記録
--      - すべて同一トランザクション
--   3. revoke_invitation(invitation_id)
--      - admin 専用、同 org スコープ
--      - pending を revoked に
--      - 監査ログを残す
--
-- token は API 側で crypto.randomBytes 由来の暗号学的に安全な文字列を渡す
-- (Math.random() などは絶対に使わない)。DB は受け取って一意制約だけ担保する。
-- ============================================

-- ============================================
-- 1. member_audit_log.target_member_id を nullable に
-- ============================================
alter table public.member_audit_log
  alter column target_member_id drop not null;

comment on column public.member_audit_log.target_member_id is
  '対象メンバー。招待操作(まだメンバー化していない)等では null を許容する。';

-- ============================================
-- 2. issue_invitation
-- ============================================
-- 例外コード:
--   - forbidden       (42501): 呼び出し側が admin でない
--   - invalid_role    (22023): role が admin/advisor 以外
--   - invalid_email   (22023): email が空
--   - already_member  (P0001): 同 email が既に自 org のメンバー

create or replace function public.issue_invitation(
  invitation_email text,
  invitation_role text,
  invitation_token text,
  invitation_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member_id uuid;
  v_caller_role text;
  v_caller_org_id uuid;
  v_normalized_email text;
  v_existing_user_id uuid;
  v_existing_member_count int;
  v_new_invitation_id uuid;
begin
  if invitation_email is null or length(trim(invitation_email)) = 0 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  if invitation_role not in ('admin', 'advisor') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  v_normalized_email := lower(trim(invitation_email));

  -- 呼び出しユーザーのメンバー情報
  select id, role, organization_id
    into v_caller_member_id, v_caller_role, v_caller_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_caller_member_id is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 既存メンバー判定:
  --   auth.users で email 一致するユーザーを引き、自 org の organization_members
  --   にいるかをチェック。SECURITY DEFINER なので auth.users を読める。
  select id into v_existing_user_id
  from auth.users
  where lower(email) = v_normalized_email
  limit 1;

  if v_existing_user_id is not null then
    select count(*) into v_existing_member_count
    from public.organization_members
    where organization_id = v_caller_org_id
      and user_id = v_existing_user_id;

    if v_existing_member_count > 0 then
      raise exception 'already_member' using errcode = 'P0001';
    end if;
  end if;

  -- 同 email・同 org の pending 招待を revoke(再発行)
  update public.organization_invitations
  set status = 'revoked'
  where organization_id = v_caller_org_id
    and lower(email) = v_normalized_email
    and status = 'pending';

  -- 新規招待を発行
  insert into public.organization_invitations (
    organization_id,
    email,
    role,
    token,
    status,
    invited_by_member_id,
    expires_at
  ) values (
    v_caller_org_id,
    v_normalized_email,
    invitation_role,
    invitation_token,
    'pending',
    v_caller_member_id,
    invitation_expires_at
  )
  returning id into v_new_invitation_id;

  -- 監査ログ(target_member_id は null:招待時点ではメンバー未登録)
  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail,
    changed_by_member_id
  ) values (
    v_caller_org_id,
    null,
    'invitation_sent',
    jsonb_build_object(
      'invitation_id', v_new_invitation_id,
      'email', v_normalized_email,
      'role', invitation_role
    ),
    v_caller_member_id
  );

  return v_new_invitation_id;
end;
$$;

comment on function public.issue_invitation(text, text, text, timestamptz) is
  '招待を発行する(admin 専用)。既存メンバーは拒否、同 email pending は revoke して再発行。'
  'token は呼び出し側で暗号学的に安全に生成して渡す。';

-- ============================================
-- 3. revoke_invitation
-- ============================================
-- 例外コード:
--   - forbidden  (42501): 呼び出し側が admin でない
--   - not_found  (P0002): invitation が同 org に存在しない
--   - not_pending(P0001): pending 以外の状態の招待を取り消そうとした

create or replace function public.revoke_invitation(
  invitation_id uuid
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
  v_inv_org_id uuid;
  v_inv_status text;
  v_inv_email text;
begin
  select id, role, organization_id
    into v_caller_member_id, v_caller_role, v_caller_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_caller_member_id is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select organization_id, status, email
    into v_inv_org_id, v_inv_status, v_inv_email
  from public.organization_invitations
  where id = invitation_id
  for update;

  if v_inv_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_inv_org_id <> v_caller_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_inv_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  update public.organization_invitations
  set status = 'revoked'
  where id = invitation_id;

  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail,
    changed_by_member_id
  ) values (
    v_caller_org_id,
    null,
    'invitation_revoked',
    jsonb_build_object(
      'invitation_id', invitation_id,
      'email', v_inv_email
    ),
    v_caller_member_id
  );
end;
$$;

comment on function public.revoke_invitation(uuid) is
  '招待を取り消す(admin 専用)。pending のみ revoked に遷移。監査ログ付き。';
