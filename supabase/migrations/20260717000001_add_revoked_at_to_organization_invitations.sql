-- ============================================
-- organization_invitations.revoked_at カラム 追加
--
-- 背景:
--   20260708000003_audit_low_batch_fixes.sql の revoke_invitation(uuid) RPC が
--     update public.organization_invitations
--        set status = 'revoked',
--            revoked_at = now()
--   と 書いて いる が、 テーブル 定義 (20260602000004_add_org_management_tables.sql)
--   には revoked_at カラム が 存在 せず、 /agency/members の 「招待 取消」 ボタン
--   から の PATCH /api/agency/invitations/[id] が 常に 500 で 落ち て いた。
--
--   同時期 に 作られ た client_invitations テーブル (20260628000005) には
--   revoked_at timestamptz が ある ため、 20260708000003 の 書き 手 は 存在 する
--   前提 で 書いた 認識 と 思われる。
--
-- 修正:
--   ・organization_invitations に revoked_at timestamptz (nullable) を 追加
--   ・issue_invitation の 再発行 パス (旧 pending を revoke する 部分) にも
--     同じ 打刻 ロジック を 通す ように 更新 (CREATE OR REPLACE)。 これで
--     「取消 済 招待 が 再発行 された 順序」 の 監査 が 揃う。
--
-- 影響:
--   ・下位 互換 な スキーマ 変更 (カラム 追加、 既存 行 は null のまま)
--   ・アプリ 側 は revoked_at を 読ま ない (revoke_invitation RPC 内 だけ で 使う)
--     ので フロント の 型変更 は 不要
-- ============================================

alter table public.organization_invitations
  add column if not exists revoked_at timestamptz;

comment on column public.organization_invitations.revoked_at is
  'revoke_invitation で status=revoked に した 時刻。 監査 と 「再発行 まで の 経過 時間」 集計 用。 既存 の revoked 行 は 遡って 埋め ない ため null の 可能性 あり。';

-- ============================================
-- issue_invitation を CREATE OR REPLACE で 上書き
-- 変更 点: 再発行 時 の 旧 pending revoke に revoked_at = now() を 追加
-- 他 は 20260602000007 と 同一
-- ============================================
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

  select id, role, organization_id
    into v_caller_member_id, v_caller_role, v_caller_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_caller_member_id is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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

  -- 同 email・同 org の pending 招待 を revoke (再発行)
  -- revoked_at も 打刻 して revoke_invitation RPC と 同じ 監査 情報 に 揃える
  update public.organization_invitations
     set status = 'revoked',
         revoked_at = now()
   where organization_id = v_caller_org_id
     and lower(email) = v_normalized_email
     and status = 'pending';

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
