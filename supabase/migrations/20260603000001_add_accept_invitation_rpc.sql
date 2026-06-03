-- ============================================
-- 組織管理基盤(S5a):招待の受諾 RPC
--
-- 招待トークン経由でログイン済みユーザーが組織に参加する処理。
-- 検証〜状態遷移〜監査ログをすべて 1 トランザクションでまとめ、
-- FOR UPDATE ロックで二重受諾の競合を防ぐ。
--
-- 検証順序(NG なら raise exception、エラーコードで UI に分岐させる):
--   1. invalid_token   : トークンが無い / 既受諾 / 失効 / 期限切れ
--   2. email_mismatch  : auth.users.email と invitation.email が一致しない
--                       (case-insensitive)
--   3. already_member  : 呼び出し user が既に organization_members にいる
--                       (1 ユーザー 1 組織制約)
--   4. has_seeker_data : 呼び出し user が求職者データを保有
--                       (resumes / career_profiles / applications /
--                        conversations のいずれか)
--                       → 求職者として既に使っているアカウントを
--                          エージェント所属に転用するのは禁止
--                          (データが宙に浮く / RLS 切替で見えなくなる)
--
-- 検証 OK なら:
--   5. profiles.account_type を 'organization_member' に昇格
--   6. organization_members に insert(role は invitation.role)
--   7. organization_invitations を accepted / accepted_at=now() に
--   8. member_audit_log に 'invitation_accepted' を記録
--
-- SECURITY DEFINER:
--   auth.users.email 参照と、profiles / organization_members / invitations
--   への横断的な書き込みのため。SET search_path=public でハイジャック対策。
-- ============================================

create or replace function public.accept_invitation(
  invitation_token text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_inv_id uuid;
  v_inv_org_id uuid;
  v_inv_email text;
  v_inv_role text;
  v_inv_status text;
  v_inv_expires_at timestamptz;
  v_existing_member_count int;
  v_seeker_data_count int;
  v_new_member_id uuid;
begin
  -- 認証チェック(SECURITY DEFINER でも auth.uid() は呼び出し側の uid を返す)
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if invitation_token is null or length(trim(invitation_token)) = 0 then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  -- 招待行を FOR UPDATE ロック(二重受諾防止)
  -- ロックしている間は同じトークンを使った別の accept_invitation 呼び出しは待つ。
  select id, organization_id, email, role, status, expires_at
    into v_inv_id, v_inv_org_id, v_inv_email, v_inv_role,
         v_inv_status, v_inv_expires_at
  from public.organization_invitations
  where token = invitation_token
  for update;

  if v_inv_id is null then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  if v_inv_status <> 'pending' or v_inv_expires_at <= now() then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  -- メール一致チェック(case-insensitive)
  -- auth.users.email は通常小文字保存だが、念のため lower() で比較する。
  select lower(email) into v_user_email
  from auth.users
  where id = v_user_id;

  if v_user_email is null or v_user_email <> lower(v_inv_email) then
    raise exception 'email_mismatch' using errcode = 'P0001';
  end if;

  -- 既に組織メンバー?(1 ユーザー 1 組織制約)
  select count(*) into v_existing_member_count
  from public.organization_members
  where user_id = v_user_id;

  if v_existing_member_count > 0 then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  -- 求職者データの存在チェック
  -- 「保有していたら拒否」する対象テーブル:
  --   resumes / career_profiles / applications / conversations
  -- これらに 1 行でもあれば、求職者として既に使っているアカウントと判断する。
  -- (messages / tasks / notifications は上記テーブル経由で派生するので
  --  最上位の 4 つだけ見れば十分)
  select
    (select count(*) from public.resumes where user_id = v_user_id)
    + (select count(*) from public.career_profiles where user_id = v_user_id)
    + (select count(*) from public.applications where user_id = v_user_id)
    + (select count(*) from public.conversations where user_id = v_user_id)
    into v_seeker_data_count;

  if v_seeker_data_count > 0 then
    raise exception 'has_seeker_data' using errcode = 'P0001';
  end if;

  -- ここから状態遷移(同一トランザクション)

  -- 5. profiles.account_type を昇格
  update public.profiles
  set account_type = 'organization_member'
  where id = v_user_id;

  -- 6. organization_members に追加(role は invitation 由来)
  insert into public.organization_members (
    organization_id,
    user_id,
    role
  ) values (
    v_inv_org_id,
    v_user_id,
    v_inv_role
  )
  returning id into v_new_member_id;

  -- 7. 招待を accepted に
  update public.organization_invitations
  set status = 'accepted',
      accepted_at = now()
  where id = v_inv_id;

  -- 8. 監査ログ
  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail,
    changed_by_member_id
  ) values (
    v_inv_org_id,
    v_new_member_id,
    'invitation_accepted',
    jsonb_build_object(
      'invitation_id', v_inv_id,
      'role', v_inv_role
    ),
    v_new_member_id
  );

  return v_new_member_id;
end;
$$;

comment on function public.accept_invitation(text) is
  '招待トークンを受諾して組織に参加する。'
  '検証(token/email/既存メンバー/求職者データ)→ account_type 昇格 → '
  'organization_members 追加 → 招待 accepted → 監査ログ、を 1Tx で実行。'
  'FOR UPDATE で二重受諾を防止。';
