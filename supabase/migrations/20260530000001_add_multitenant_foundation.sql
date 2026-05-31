-- ============================================
-- マルチテナント基盤
--
-- BtoB CRM機能の土台:
--   - エージェント企業(organizations)
--   - 企業メンバー(organization_members)
--   - profiles に account_type 追加
--
-- 既存ユーザーは全員 'seeker'(求職者)として扱う(default 'seeker')
-- ============================================

-- ============================================
-- 1. profiles に account_type を追加
-- ============================================
-- なぜ profiles に持たせるか:
--   ログイン直後の最初の問い合わせで「求職者かエージェントメンバーか」を
--   1クエリで判定したいため。organization_members を毎回 join するより安価。
alter table public.profiles
  add column if not exists account_type text not null default 'seeker'
    check (account_type in ('seeker', 'organization_member'));

comment on column public.profiles.account_type is
  'アカウント種別: seeker(求職者) または organization_member(エージェント企業メンバー)';

-- ============================================
-- 2. organizations テーブル(エージェント企業)
-- ============================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'エージェント企業(BtoB契約者)';

alter table public.organizations enable row level security;

-- ============================================
-- 3. organization_members テーブル(企業メンバー)
-- ============================================
-- 1人のユーザーは1つの企業に1回だけ所属(unique user_id)。
-- 兼任は今後の検討事項なので、現時点では unique 制約で防ぐ。
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'advisor'
    check (role in ('admin', 'advisor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

comment on table public.organization_members is '企業メンバー(管理者またはアドバイザー)';
comment on column public.organization_members.role is 'admin(企業管理者) または advisor(キャリアアドバイザー)';

create index if not exists idx_org_members_org_id on public.organization_members(organization_id);
create index if not exists idx_org_members_user_id on public.organization_members(user_id);

alter table public.organization_members enable row level security;

-- ============================================
-- 4. RLS ポリシー
--
-- 厳密にテナント分離する:
--   - メンバーは自分が所属する企業のデータのみ閲覧可能
--   - 別企業のデータは一切見られない
--   - 管理者のみが企業情報・メンバー情報を更新可能
-- ============================================

-- organizations: 所属メンバーは閲覧可能
create policy "Members can view their own organization"
  on public.organizations for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organizations.id
        and organization_members.user_id = auth.uid()
    )
  );

-- organizations: 管理者は更新可能
create policy "Admins can update their own organization"
  on public.organizations for update
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organizations.id
        and organization_members.user_id = auth.uid()
        and organization_members.role = 'admin'
    )
  );

-- organization_members: 同じ企業のメンバー同士は閲覧可能
create policy "Members can view members in same organization"
  on public.organization_members for select
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- organization_members: 管理者のみ追加可能
create policy "Admins can insert members in their organization"
  on public.organization_members for insert
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
        and role = 'admin'
    )
  );

-- organization_members: 管理者のみ更新可能
create policy "Admins can update members in their organization"
  on public.organization_members for update
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
        and role = 'admin'
    )
  );

-- organization_members: 管理者のみ削除可能
create policy "Admins can delete members in their organization"
  on public.organization_members for delete
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
        and role = 'admin'
    )
  );

-- ============================================
-- 5. updated_at 自動更新トリガー
--
-- 既存マイグレーションには set_updated_at 関数がないため、ここで新設する。
-- create or replace なので将来再定義されても安全。
-- ============================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

drop trigger if exists set_organization_members_updated_at on public.organization_members;
create trigger set_organization_members_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();
