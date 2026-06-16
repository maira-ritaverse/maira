-- =====================================================================
-- 顧客向け埋め込みフォーム(intake_forms)
--
-- エージェントが「自社サイトに埋め込むためのフォーム URL」を発行できるようにする。
-- 顧客がフォームから送信すると、自動で client_records が作成される(link_status='unlinked')。
--
-- 設計:
--   - 組織スコープ。1 組織で複数フォーム作成可(media 別に entry_site をプリセット)
--   - URL は token(uuid)ベースの公開 URL(/f/[token])
--   - is_active = false にすると新規受付を停止
--   - admin だけが作成 / 編集 / 削除可。組織メンバーは閲覧可
--   - 送信側の認証は不要。サーバー側で token から organization_id を解決して RLS バイパス
--     (service role 経由で INSERT)。
-- =====================================================================

create table if not exists public.intake_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 公開 URL のトークン(uuid v4)。連番等の予測可能な値は使わない
  token uuid not null unique default gen_random_uuid(),
  -- 管理画面に表示する名前(例:「自社サイト用」「○○媒体用」)
  name text not null check (length(trim(name)) > 0 and length(name) <= 100),
  -- 送信時に自動でセットする entry_site(NULL 可)
  entry_site text,
  -- 受付の有効 / 無効
  is_active boolean not null default true,
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists intake_forms_org_idx
  on public.intake_forms (organization_id, created_at desc);

comment on table public.intake_forms is
  '顧客向け埋め込みフォーム(公開 URL 経由で client_records を作成するための受付トークン)';
comment on column public.intake_forms.token is '公開 URL のトークン(/f/[token])';
comment on column public.intake_forms.entry_site is '送信時に自動セットする entry_site 値';

-- updated_at トリガー
drop trigger if exists set_intake_forms_updated_at on public.intake_forms;
create trigger set_intake_forms_updated_at
  before update on public.intake_forms
  for each row execute function public.set_updated_at();

-- ===========================
-- RLS
-- ===========================
alter table public.intake_forms enable row level security;

-- SELECT:同組織メンバー
drop policy if exists "Org members can view intake forms" on public.intake_forms;
create policy "Org members can view intake forms"
  on public.intake_forms for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE:admin のみ
drop policy if exists "Admins can insert intake forms" on public.intake_forms;
create policy "Admins can insert intake forms"
  on public.intake_forms for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can update intake forms" on public.intake_forms;
create policy "Admins can update intake forms"
  on public.intake_forms for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can delete intake forms" on public.intake_forms;
create policy "Admins can delete intake forms"
  on public.intake_forms for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
