-- =====================================================================
-- 監査 LOW 一括 修正 (L1-L4)
--
-- L1: change_member_role / change_member_permission / revoke_invitation RPC が
--     not_found と forbidden を 分岐 → 別 org UUID 存在 オラクル
-- L2: merge_client_records も 同 パターン
-- L3: meeting_interview_shares PATCH で seeker 直 更新 で expires_at 延長 が 可能
-- L4: line_link_codes SELECT policy が 組織 全員 に 公開 → 担当 外 が 平文 コード
--     取得 で 乗っ取り 可能 (内部者)
-- =====================================================================

-- ============================================
-- L1: change_member_role の SELECT に org 一致 を 追加、 一律 not_found に
-- ============================================
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
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_target_role text;
  v_admin_count int;
begin
  if new_role not in ('admin', 'advisor') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role into v_caller_role
    from public.organization_members
   where user_id = v_caller_user_id
     and organization_id = v_caller_org_id
   limit 1;
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 「同 org 制約 付き」 SELECT: 別 org の UUID は 存在 して も 「not_found」 で 統一
  select role into v_target_role
    from public.organization_members
   where id = target_member_id
     and organization_id = v_caller_org_id
   for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_target_role = 'admin' and new_role = 'advisor' then
    select count(*) into v_admin_count
      from public.organization_members
     where organization_id = v_caller_org_id
       and role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  update public.organization_members
     set role = new_role,
         updated_at = now()
   where id = target_member_id
     and organization_id = v_caller_org_id;

  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail
  ) values (
    v_caller_org_id,
    target_member_id,
    'role_changed',
    jsonb_build_object('from', v_target_role, 'to', new_role)
  );
end;
$$;

-- ============================================
-- L1: change_member_permission も 同様
-- ============================================
create or replace function public.change_member_permission(
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
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_target_role text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role into v_caller_role
    from public.organization_members
   where user_id = v_caller_user_id
     and organization_id = v_caller_org_id
   limit 1;
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role into v_target_role
    from public.organization_members
   where id = target_member_id
     and organization_id = v_caller_org_id
   for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.organization_members
     set member_permissions = coalesce(member_permissions, '{}'::jsonb)
                              || jsonb_build_object(p_permission_key, granted),
         updated_at = now()
   where id = target_member_id
     and organization_id = v_caller_org_id;
end;
$$;

-- ============================================
-- L1: revoke_invitation も 同様
-- ============================================
create or replace function public.revoke_invitation(
  invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_status text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role into v_caller_role
    from public.organization_members
   where user_id = v_caller_user_id
     and organization_id = v_caller_org_id
   limit 1;
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 「同 org 制約 付き」 SELECT
  select status into v_status
    from public.organization_invitations
   where id = invitation_id
     and organization_id = v_caller_org_id
   for update;

  if v_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  update public.organization_invitations
     set status = 'revoked',
         revoked_at = now()
   where id = invitation_id
     and organization_id = v_caller_org_id;
end;
$$;

-- ============================================
-- L4: line_link_codes SELECT policy を 発行 者 限定 に
-- 全 org 公開 → issued_by_user_id 一致 のみ (or admin)
-- ============================================
drop policy if exists llc_select on public.line_link_codes;
create policy llc_select on public.line_link_codes
  for select
  using (
    organization_id = public.current_user_organization_id()
    and (
      issued_by_user_id = auth.uid()
      or exists (
        select 1 from public.organization_members om
         where om.user_id = auth.uid()
           and om.organization_id = organization_id
           and om.role = 'admin'
      )
    )
  );

comment on policy llc_select on public.line_link_codes is
  '発行 者 本人 or 組織 admin のみ 6 桁 コード を 参照 可能。 L4 修正。';

-- ============================================
-- L3: meeting_interview_shares の seeker UPDATE を 保護 列 に 制限
-- BEFORE UPDATE トリガ で expires_at / share_token / seeker_user_id を 直 変更 禁止
-- ============================================
create or replace function public.enforce_meeting_interview_shares_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  -- seeker が 直接 変更 できて い い の は status / responded_at / responded_message のみ。
  -- expires_at / share_token / seeker_user_id / organization_id 等 は 発行 側 の 情報。
  if new.expires_at is distinct from old.expires_at then
    raise exception 'expires_at is immutable via direct update' using errcode = '42501';
  end if;
  if new.share_token is distinct from old.share_token then
    raise exception 'share_token is immutable' using errcode = '42501';
  end if;
  if new.seeker_user_id is distinct from old.seeker_user_id then
    raise exception 'seeker_user_id is immutable' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meeting_interview_shares_immutable
  on public.meeting_interview_shares;
create trigger trg_meeting_interview_shares_immutable
  before update on public.meeting_interview_shares
  for each row
  execute function public.enforce_meeting_interview_shares_immutable();
