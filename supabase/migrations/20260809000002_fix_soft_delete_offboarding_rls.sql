-- =====================================================================
-- H1 / M1: soft-delete されたメンバーが権限を保持する穴を塞ぐ
--
-- 背景:
--   20260719000003 でメンバー削除が soft-delete(organization_members.removed_at
--   打刻・行は残る)に切り替わった。RLS ヘルパー current_user_organization_id/
--   role() は removed_at is null で除外するよう更新されたが、ヘルパーを経由せず
--   organization_members を直接引く箇所が取り残された。deactivate_member は
--   セッションを失効させないため、解雇済みユーザーは有効な JWT で PostgREST を
--   直接叩ける(anon key は公開設計)。
--
-- 本マイグレーションの対象:
--   H1: issue_invitation の caller 判定に removed_at is null が無く、解雇済み
--       admin が招待発行 → 別メールを admin 招待 → 受諾で組織を再乗っ取りできる。
--   M1: resumes / cvs の「自組織 linked クライアント閲覧」ポリシーが
--       organization_members をインライン副問合せで引いており removed_at 無し。
--       解雇済みメンバーが自分の JWT で resumes/cvs を直接 SELECT し、担当だった
--       クライアントの履歴書/職務経歴書(PII)を無期限に読み続けられる。
--
--   ※ これらの RLS 修正だけで、解雇済みメンバーの stale JWT からのデータ読み取り
--     (resumes/cvs)と招待発行(issue_invitation)は即座に遮断される(RLS は
--     auth.uid() を live で評価するため、JWT が有効でも removed_at で弾かれる)。
--     認証層でのセッション即時失効(GoTrue admin logout)は追加ハードニングとして
--     follow-up(SDK が userId 指定の失効を素直に公開していないため別途対応)。
-- =====================================================================

-- ---------------------------------------------------------------------
-- H1: issue_invitation を CREATE OR REPLACE(caller / already_member 判定に
--     removed_at is null を追加)。他は 20260717000001 と同一。
-- ---------------------------------------------------------------------
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

  -- ★H1 修正: removed_at is null を追加。これが無いと soft-delete された(解雇済み)
  --   admin の行がヒットし、v_caller_role='admin' を通過して招待を発行できてしまう。
  select id, role, organization_id
    into v_caller_member_id, v_caller_role, v_caller_org_id
  from public.organization_members
  where user_id = auth.uid()
    and removed_at is null
  limit 1;

  if v_caller_member_id is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_existing_user_id
  from auth.users
  where lower(email) = v_normalized_email
  limit 1;

  if v_existing_user_id is not null then
    -- ★H1 修正: removed_at is null を追加。解雇済み(soft-delete)メンバーは
    --   「既存メンバー」に数えない = 再招待を許可する(soft-delete の本来の意図)。
    select count(*) into v_existing_member_count
    from public.organization_members
    where organization_id = v_caller_org_id
      and user_id = v_existing_user_id
      and removed_at is null;

    if v_existing_member_count > 0 then
      raise exception 'already_member' using errcode = 'P0001';
    end if;
  end if;

  -- 同 email・同 org の pending 招待 を revoke (再発行)
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

-- ---------------------------------------------------------------------
-- M1: resumes / cvs の linked クライアント閲覧ポリシーに removed_at is null を追加。
--     現行の有効ポリシーは 20260607000011。organization_members インライン副問合せに
--     removed_at フィルタが無いため、解雇済みメンバーが読み続けられる。
-- ---------------------------------------------------------------------
drop policy if exists "Org members can view linked client resumes" on public.resumes;

create policy "Org members can view linked client resumes"
  on public.resumes for select
  using (
    user_id in (
      select linked_user_id from public.client_records
      where linked_user_id is not null
        and (
          link_status = 'linked'
          or (
            link_status = 'revoke_requested'
            and revoke_deadline is not null
            and revoke_deadline > now()
          )
        )
        and organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
            and removed_at is null
        )
    )
  );

comment on policy "Org members can view linked client resumes" on public.resumes is
  '開示フロー Phase 6。linked または期限内 revoke_requested の自組織クライアントの '
  '履歴書のみ select 可。removed_at 済メンバーは除外(オフボーディング M1 修正)。'
  'INSERT/UPDATE/DELETE は本人限定の既存ポリシーで不変。';

drop policy if exists "Org members can view linked client cvs" on public.cvs;

create policy "Org members can view linked client cvs"
  on public.cvs for select
  using (
    user_id in (
      select linked_user_id from public.client_records
      where linked_user_id is not null
        and (
          link_status = 'linked'
          or (
            link_status = 'revoke_requested'
            and revoke_deadline is not null
            and revoke_deadline > now()
          )
        )
        and organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
            and removed_at is null
        )
    )
  );

comment on policy "Org members can view linked client cvs" on public.cvs is
  '開示フロー Phase 6。linked または期限内 revoke_requested の自組織クライアントの '
  '職務経歴書のみ select 可。removed_at 済メンバーは除外(オフボーディング M1 修正)。'
  'INSERT/UPDATE/DELETE は本人限定の既存ポリシーで不変。';
