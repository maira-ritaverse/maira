-- =====================================================================
-- organization_members を soft delete に 切替 (Phase A #1 / Step 3)
--
-- 前提:
--   ・Step 1 (20260719000002) で removed_at カラム + partial index を追加済
--   ・Step 2 (別コミット) で TS/API 側に .is("removed_at", null) フィルタ追加済
--
-- 本 migration で 挙動が変わる もの:
--   ・RLS helper 2 関数 が `removed_at is null` で 絞る
--     → 除外済 メンバー は auth.uid() 経由 で 参照 不可 = テナント 隔離 が
--       更新 直後 に 発火 (org 分離 の 完全性 を 維持)
--   ・organization_members の RLS ポリシー 4 本 に `removed_at is null` を 追加
--     → 除外済 メンバー の 行 は SELECT / UPDATE / DELETE で 見え なく なる
--   ・`unique (user_id)` を drop し、 partial unique index (`where removed_at
--     is null`) に 置換
--     → 除外済 の 行 が 残っていても、 同 user_id の 再招待 が 可能 に なる
--   ・`accept_invitation` の 「既存 メンバー チェック」 を `removed_at is null`
--     で 絞る → 除外済 メンバー が 再招待 経由 で 再加入 可能
--   ・`deactivate_member` を DELETE から UPDATE removed_at = now() に 切替
--     → 実際 の 履歴 保持 が 発火 する 起点
--
-- 意図 的 に 変更 しない もの:
--   ・list_organization_member_display_names (別 migration で 別途 判断):
--     現状 は 全 member の 表示名 を 返す = 履歴 表示 でも 「(退職 者)」を
--     表示 したい ため。 呼出 側 UI で 「(退職)」 バッジ を 出す 前提。
--   ・過去 実績 集計 系 (get_referral_kpi_by_member 等): 意図 的 に 履歴 全 表示
--
-- 未対応 (follow-up commit で 段階的 に):
--   ・list_organization_members_with_meta   (メンバー一覧 UI)
--   ・issue_invitation                      (既存 メンバー チェック)
--   ・change_member_role / change_member_permission / revoke_invitation
--   ・get_platform_ai_total_quota_for_caller
--   ・count_org_ai_usage_total_this_month   (集計 の 分母)
--   ・assign_client_to_team / unassign_client_from_team
--
--   これら は 除外済 メンバー を 含めて 集計 / 表示 しても 動作 は 破綻 しない
--   (単に 除外済 メンバー が 一覧 に 混ざる 程度) ので、 本 migration とは
--   別 に 順次 対応 する。
--
-- 適用:
--   dev で 1 週間 検証 後、 prod に 適用。 検証 事項:
--     1. 除外済 メンバー の cookie で / api にアクセス → 403 が 返ること
--     2. 除外済 と 同じ email で 再招待 → accept_invitation が 成功 する こと
--     3. seat sync (Stripe extra_seat quantity) が 除外済 を 数え ない こと
--     4. team 内 の 他 メンバー が member 一覧 で 除外済 を 見え なくなる こと
-- =====================================================================

-- ─── 1. RLS helper 2 関数 の 再定義 ────────────────────────────
-- current_user_organization_id / current_user_organization_role が 75 migration
-- ファイル の RLS ポリシー の 分離軸 に なって いる ので、 これ ら を 更新 する
-- こと で ほぼ 全 RLS が soft delete に 自動 対応 する。

create or replace function public.current_user_organization_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid()
    and removed_at is null
  limit 1;
$$;

comment on function public.current_user_organization_id() is
  'RLS 再帰回避用。現在の認証ユーザーが所属する企業の id を返す(なければ null)。 removed_at 済 メンバー は 除外 (Phase A #1 で 追加)。';

create or replace function public.current_user_organization_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.organization_members
  where user_id = auth.uid()
    and removed_at is null
  limit 1;
$$;

comment on function public.current_user_organization_role() is
  'RLS 再帰回避用。現在の認証ユーザーの組織内ロール(admin / advisor)を返す(なければ null)。 removed_at 済 メンバー は 除外 (Phase A #1 で 追加)。';


-- ─── 2. organization_members の RLS policy 再定義 ─────────────
-- SELECT: 同 org の 現役 メンバー のみ 見せる。 除外済 メンバー を 履歴 として
-- 見たい 場合 は SECURITY DEFINER RPC (list_organization_member_display_names 等)
-- 経由 で 明示的 に 参照 する。

drop policy if exists "Members can view members in same organization" on public.organization_members;
drop policy if exists "Admins can insert members in their organization" on public.organization_members;
drop policy if exists "Admins can update members in their organization" on public.organization_members;
drop policy if exists "Admins can delete members in their organization" on public.organization_members;

create policy "Members can view members in same organization"
  on public.organization_members for select
  using (
    organization_id = public.current_user_organization_id()
    and removed_at is null
  );

create policy "Admins can insert members in their organization"
  on public.organization_members for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "Admins can update members in their organization"
  on public.organization_members for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "Admins can delete members in their organization"
  on public.organization_members for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );


-- ─── 3. unique (user_id) → partial unique index (WHERE removed_at is null) ───
-- 既存 制約 の 名前 は マイグレーション で 明示 されて いない (Postgres が 自動
-- 命名)。 information_schema から 動的 に drop する。
-- 除外済 の 行 が 残って いる 状態 で、 同じ user_id で 現役 が 追加 された とき、
-- 一 意 は WHERE removed_at is null で 保つ (=現役 は 常に 1 行 のみ)。

do $$
declare
  v_constraint_name text;
begin
  select constraint_name into v_constraint_name
    from information_schema.table_constraints
   where table_schema = 'public'
     and table_name = 'organization_members'
     and constraint_type = 'UNIQUE'
     and constraint_name like '%user_id%'
   limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.organization_members drop constraint %I', v_constraint_name);
  end if;
end
$$;

create unique index if not exists ux_organization_members_active_user_id
  on public.organization_members (user_id)
  where removed_at is null;

comment on index public.ux_organization_members_active_user_id is
  '「1 ユーザー 1 組織」制約 の partial 版。 除外済 の 行 が 残って いても 現役 の 一意性 を 保つ (Phase A #1 で 導入)。';


-- ─── 4. deactivate_member RPC: DELETE → UPDATE removed_at ─────
-- 過去 実績 (referrals.created_by_member_id / placements.created_by_member_id
-- 等 の FK に 対する 参照) を 保持 する ため、 物理 削除 でなく soft delete。
-- FK は 全 て on delete set null な ので、 UPDATE removed_at では FK 破壊 は
-- 起き ない (この 挙動 は 変わり)。

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
     and removed_at is null
   limit 1;

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 対象 メンバー を 「同 org + 現役」 制約 付き で 引く。
  -- 既に 除外済 の 行 を 二重 に 除外 しよう と した 場合 も not_found と する
  -- (冪等性 の 観点 で 「既 に 除外 済」 と 「存在 しない」を 区別 する 意味 が
  --  薄い)。
  select role into v_target_role
    from public.organization_members
   where id = target_member_id
     and organization_id = v_caller_org_id
     and removed_at is null
   for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 最後 の admin は 除外 拒否 (現役 admin の カウント で 判定)
  if v_target_role = 'admin' then
    select count(*) into v_admin_count
      from public.organization_members
     where organization_id = v_caller_org_id
       and role = 'admin'
       and removed_at is null;
    if v_admin_count <= 1 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  -- soft delete = removed_at に 現在時刻 を 記録
  update public.organization_members
     set removed_at = now()
   where id = target_member_id
     and organization_id = v_caller_org_id;

  -- 監査 ログ (member_audit_log の action='member_removed')
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
    jsonb_build_object('removed_role', v_target_role, 'soft_delete', true)
  );

  return target_member_id;
end;
$$;

comment on function public.deactivate_member(uuid) is
  'メンバー 除外 の 集約 RPC。 同 組織 admin 限定、 最後 の admin は 除外 不可、 監査 ログ を 残す。 別 org UUID も 「not_found」 統一 で 情報 漏洩 面 を 塞ぐ。 Phase A #1 で soft delete (removed_at = now()) に 切替。';


-- ─── 5. accept_invitation: 既存 メンバー チェック で 除外済 を 無視 ─────
-- 現役 メンバー が いる か どうか だけ を 判定 (=除外済 の 履歴 は 「同時 に
-- 2 org は 不可」 の 制約 に は 関与 しない)。 これ で 除外 後 の 再招待 が
-- 成功 する ように なる。

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
  v_inv_expires_at timestamptz;
  v_inv_status text;
  v_existing_member_count int;
  v_seeker_data_count int;
  v_new_member_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- トークン で 招待 を lock 取り
  select id, organization_id, invited_email, invited_role, expires_at, status
    into v_inv_id, v_inv_org_id, v_inv_email, v_inv_role, v_inv_expires_at, v_inv_status
    from public.organization_invitations
   where token = invitation_token
   for update;

  if v_inv_id is null then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  if v_inv_status <> 'pending' then
    raise exception 'invitation_already_processed' using errcode = 'P0001';
  end if;

  if v_inv_expires_at < now() then
    raise exception 'invitation_expired' using errcode = 'P0001';
  end if;

  -- メール一致 チェック
  select lower(email) into v_user_email
    from auth.users
   where id = v_user_id;

  if v_user_email is null or v_user_email <> lower(v_inv_email) then
    raise exception 'email_mismatch' using errcode = 'P0001';
  end if;

  -- 既に 現役 メンバー ? (1 ユーザー 1 組織 制約、 除外済 は 除く)
  -- removed_at is null に する こと で、 除外 → 再招待 → 復活 の パス が 通る
  -- ように なる (Phase A #1 の 主 目的)。
  select count(*) into v_existing_member_count
    from public.organization_members
   where user_id = v_user_id
     and removed_at is null;

  if v_existing_member_count > 0 then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  -- 求職者 データ の 存在 チェック (既存 挙動)
  select
    (select count(*) from public.resumes where user_id = v_user_id)
    + (select count(*) from public.career_profiles where user_id = v_user_id)
    + (select count(*) from public.applications where user_id = v_user_id)
    + (select count(*) from public.conversations where user_id = v_user_id)
    into v_seeker_data_count;

  if v_seeker_data_count > 0 then
    raise exception 'has_seeker_data' using errcode = 'P0001';
  end if;

  -- 5. profiles.account_type を 昇格
  update public.profiles
     set account_type = 'organization_member'
   where id = v_user_id;

  -- 6. organization_members に 追加。
  --    もし 除外済 の 行 が 同 user_id で 残って いる 場合、 partial unique
  --    index が WHERE removed_at is null な ので INSERT は 成功 する。
  --    「同じ user_id で 除外済 + 現役 が 2 行 残る」 状態 に なる が、 これは
  --    履歴 として 意図 通り (過去 に この 組織 に いた 事実 が 残る)。
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

  -- 7. 招待 を accepted に
  update public.organization_invitations
     set status = 'accepted',
         accepted_at = now()
   where id = v_inv_id;

  -- 8. 監査 ログ
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
  '招待 トークン を 受諾 して organization_members に 追加。 除外済 メンバー は 「既存 メンバー」 として カウント しない (Phase A #1)、 これ で 「削除 → 再招待」 の 復活 パス が 通る。';
