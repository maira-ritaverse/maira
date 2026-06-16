-- =====================================================================
-- カスタムフィールド(組織別追加列)
--
-- 業務上「業種特有」「組織独自の管理項目」を組織自身が定義できるようにする。
--   - client_custom_field_definitions:組織ごとのフィールド定義
--   - client_records.custom_fields:1 顧客 × 全カスタム値を 1 JSONB に格納
--
-- 値の暗号化はしない(構造化検索の対象になりうるため平文)。
-- 機密の自由記述は encrypted_meeting_notes 等の既存列を使うこと。
-- =====================================================================

create table if not exists public.client_custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- プログラマブルなキー(英数 + アンダースコア)。client_records.custom_fields のキーになる
  key text not null check (key ~ '^[a-z][a-z0-9_]*$' and length(key) <= 50),
  label text not null check (length(trim(label)) > 0 and length(label) <= 100),
  field_type text not null check (field_type in ('text', 'number', 'date', 'select', 'boolean')),
  -- select 型のときに使う選択肢(text[])
  options text[] not null default '{}'::text[],
  is_required boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists ccfd_org_order_idx
  on public.client_custom_field_definitions (organization_id, display_order, created_at);

comment on table public.client_custom_field_definitions is
  'カスタムフィールド定義(組織別、client_records.custom_fields のキー / 型 を決める)';

drop trigger if exists set_ccfd_updated_at on public.client_custom_field_definitions;
create trigger set_ccfd_updated_at
  before update on public.client_custom_field_definitions
  for each row execute function public.set_updated_at();

alter table public.client_custom_field_definitions enable row level security;

drop policy if exists "Org members can view ccfd" on public.client_custom_field_definitions;
create policy "Org members can view ccfd"
  on public.client_custom_field_definitions for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Admins can insert ccfd" on public.client_custom_field_definitions;
create policy "Admins can insert ccfd"
  on public.client_custom_field_definitions for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can update ccfd" on public.client_custom_field_definitions;
create policy "Admins can update ccfd"
  on public.client_custom_field_definitions for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can delete ccfd" on public.client_custom_field_definitions;
create policy "Admins can delete ccfd"
  on public.client_custom_field_definitions for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- client_records にカスタムフィールド格納用 jsonb を追加。
-- 既存行は default '{}'::jsonb で初期化される。
alter table public.client_records
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column public.client_records.custom_fields is
  'カスタムフィールドの値(client_custom_field_definitions の key → value のオブジェクト)';
