-- =====================================================================
-- メールテンプレート(email_templates)
--
-- 組織ごとに「件名 + 本文」のテンプレを保存できるようにする。
-- 個別 / 一括メール送信ダイアログから呼び出して件名と本文を自動入力する。
--
-- 設計:
--   - 組織スコープ(同組織の全メンバーが閲覧 / 利用可)
--   - 編集 / 削除 / 作成は admin 限定(advisor が誤って消すのを防ぐ)
--   - 同一(organization_id, name)はユニーク(同名上書きは PATCH で行う)
-- =====================================================================

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and length(name) <= 100),
  subject text not null check (length(subject) > 0 and length(subject) <= 200),
  body text not null check (length(body) > 0 and length(body) <= 5000),
  -- 作成者(後追い表示用、admin が抜けた場合は null)
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_templates_org_name_idx
  on public.email_templates (organization_id, name);

create index if not exists email_templates_org_updated_idx
  on public.email_templates (organization_id, updated_at desc);

comment on table public.email_templates is
  'メールテンプレート(組織スコープ、admin 編集可、{client_name} 等の変数差替えに対応)';

-- 更新日時の自動セット(set_updated_at は既存)
drop trigger if exists set_email_templates_updated_at on public.email_templates;
create trigger set_email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

-- ===========================
-- RLS
-- ===========================
alter table public.email_templates enable row level security;

-- SELECT:同組織メンバーは全員閲覧可
drop policy if exists "Org members can view email templates" on public.email_templates;
create policy "Org members can view email templates"
  on public.email_templates for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE:admin のみ
drop policy if exists "Admins can insert email templates" on public.email_templates;
create policy "Admins can insert email templates"
  on public.email_templates for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can update email templates" on public.email_templates;
create policy "Admins can update email templates"
  on public.email_templates for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can delete email templates" on public.email_templates;
create policy "Admins can delete email templates"
  on public.email_templates for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
