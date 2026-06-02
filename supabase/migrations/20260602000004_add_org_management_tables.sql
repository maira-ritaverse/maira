-- ============================================
-- 組織管理基盤(S1):権限・招待・監査ログ
--
-- BtoB エージェントの組織内ガバナンスを支える 3 テーブル。
--   - member_permissions: アドバイザーごとの権限フラグ(現状は export のみ想定)
--   - organization_invitations: メール招待(トークン経由)
--   - member_audit_log: メンバー操作の汎用監査
--
-- RLS は client_records と同じ「SECURITY DEFINER ヘルパー」方式に揃える。
--   - SELECT: 同 organization のメンバー全員
--   - INSERT/UPDATE/DELETE: admin のみ
-- 既存の current_user_organization_id() / current_user_organization_role()
-- を利用し、無限再帰を回避する。
--
-- ポリシー名は 63 文字制限に注意し、テーブルごとに mp_* / inv_* / mal_*
-- のプレフィックスで短く統一する。
-- ============================================

-- ============================================
-- 1. member_permissions(権限フラグ)
-- ============================================
-- 1メンバー × 1権限キーで 1 行。granted=false も「明示的に剥奪」として保持できる。
-- granted_by_member_id は監査用(誰がトグルしたか)。
create table if not exists public.member_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.organization_members(id) on delete cascade,
  permission_key text not null,
  granted boolean not null default false,
  granted_by_member_id uuid references public.organization_members(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (member_id, permission_key)
);

comment on table public.member_permissions is
  'メンバー単位の権限フラグ(現状は export のみ)。admin は本テーブルに関わらず常に許可。';
comment on column public.member_permissions.permission_key is
  '権限キー。アプリ側 PERMISSION_KEYS と同期(例: export)。';

create index if not exists idx_member_permissions_member
  on public.member_permissions(member_id);
create index if not exists idx_member_permissions_org
  on public.member_permissions(organization_id);

alter table public.member_permissions enable row level security;

-- SELECT: 同 org の全メンバーが閲覧可
create policy mp_select
  on public.member_permissions for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: admin のみ
create policy mp_admin_insert
  on public.member_permissions for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- UPDATE: admin のみ
create policy mp_admin_update
  on public.member_permissions for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- DELETE: admin のみ
create policy mp_admin_delete
  on public.member_permissions for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_member_permissions_updated_at on public.member_permissions;
create trigger set_member_permissions_updated_at
  before update on public.member_permissions
  for each row execute function public.set_updated_at();

-- ============================================
-- 2. organization_invitations(招待)
-- ============================================
-- token はランダム文字列(API 側で crypto.randomUUID 等で生成)で unique。
-- expires_at は API 側で「now() + 7d」等を入れる前提(DB default は持たない)。
create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'advisor')),
  token text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  invited_by_member_id uuid references public.organization_members(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.organization_invitations is
  'エージェント企業のメール招待。token 経由で受諾、admin のみ発行/失効。';

create index if not exists idx_org_invitations_token
  on public.organization_invitations(token);
create index if not exists idx_org_invitations_org
  on public.organization_invitations(organization_id);

alter table public.organization_invitations enable row level security;

-- SELECT: 同 org の全メンバーが閲覧可(招待状況の可視化のため)
-- ※招待リンク経由の受諾フローでは別途 service_role / token 検証で取得する想定
create policy inv_select
  on public.organization_invitations for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: admin のみ
create policy inv_admin_insert
  on public.organization_invitations for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- UPDATE: admin のみ(失効・受諾済みフラグの更新)
create policy inv_admin_update
  on public.organization_invitations for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- DELETE: admin のみ
create policy inv_admin_delete
  on public.organization_invitations for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ============================================
-- 3. member_audit_log(監査ログ、汎用)
-- ============================================
-- action は自由文字列(例: 'role_changed', 'permission_granted', 'invited',
-- 'removed' など)。detail に before/after を jsonb で持つ。
-- 同 org メンバーは閲覧可、書き込みは admin のみ(admin 操作の一部として書く)。
create table if not exists public.member_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_member_id uuid not null references public.organization_members(id),
  action text not null,
  detail jsonb,
  changed_by_member_id uuid references public.organization_members(id),
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.member_audit_log is
  'メンバー操作の監査ログ(role 変更、権限トグル、招待・削除など汎用)';

create index if not exists idx_member_audit_org
  on public.member_audit_log(organization_id, changed_at desc);

alter table public.member_audit_log enable row level security;

-- SELECT: 同 org の全メンバーが閲覧可
create policy mal_select
  on public.member_audit_log for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: admin のみ
create policy mal_admin_insert
  on public.member_audit_log for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- UPDATE: admin のみ(基本書き換えない想定だがポリシーは揃える)
create policy mal_admin_update
  on public.member_audit_log for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- DELETE: admin のみ
create policy mal_admin_delete
  on public.member_audit_log for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
