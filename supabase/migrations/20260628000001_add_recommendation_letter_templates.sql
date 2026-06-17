-- =====================================================================
-- 推薦文テンプレート(recommendation_letter_templates)
--
-- 目的:
--   ・エージェントが求人企業に提出する「推薦文(推薦状)」の
--     冒頭(prefix_body)・末尾(suffix_body)の定型句を組織共通で
--     管理し、毎回書き直す手間を無くす。
--   ・本文(body)は推薦先(求人)ごとに変わるので、ここではテンプレ化しない。
--     prefix/suffix はレンダリング層(プレビュー / PDF / コピー)で本文と連結する。
--
-- 設計:
--   ・組織スコープ。同組織の全メンバーが閲覧可、編集 / 削除 / 作成は admin 限定。
--     email_templates と同じ運用方針(advisor の誤操作を防ぐため)。
--   ・(organization_id, name) は unique。同名は PATCH で上書き。
--
-- なぜ平文(text)で持つか:
--   ・テンプレ自体は「拝啓 時下ますますご清祥のこととお慶び申し上げます」のような
--     定型句で、機密情報(候補者の経歴)は含まない。
--   ・暗号化対象は推薦文本体(recommendation_letters.encrypted_body)のみで十分。
-- =====================================================================

create table if not exists public.recommendation_letter_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- テンプレ名(画面選択用、組織内で一意)
  name text not null check (length(trim(name)) > 0 and length(name) <= 100),

  -- 冒頭定型句(例:拝啓〜の挨拶文)
  prefix_body text not null check (length(prefix_body) <= 2000),
  -- 末尾定型句(例:〜敬具、組織連絡先)
  suffix_body text not null check (length(suffix_body) <= 2000),

  -- 作成者(admin が抜けた場合は null)
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists recommendation_letter_templates_org_name_idx
  on public.recommendation_letter_templates (organization_id, name);

create index if not exists recommendation_letter_templates_org_updated_idx
  on public.recommendation_letter_templates (organization_id, updated_at desc);

comment on table public.recommendation_letter_templates is
  '推薦文テンプレート(組織スコープ、冒頭 / 末尾の定型句、admin 編集可)';

-- 更新日時の自動セット(set_updated_at は 20260530000001 で作成済み)
drop trigger if exists set_recommendation_letter_templates_updated_at
  on public.recommendation_letter_templates;
create trigger set_recommendation_letter_templates_updated_at
  before update on public.recommendation_letter_templates
  for each row execute function public.set_updated_at();

-- ===========================
-- RLS:email_templates と同パターン
-- ===========================
alter table public.recommendation_letter_templates enable row level security;

-- SELECT:同組織メンバーは全員閲覧可(推薦文編集画面で使うため)
drop policy if exists "Org members can view recommendation letter templates"
  on public.recommendation_letter_templates;
create policy "Org members can view recommendation letter templates"
  on public.recommendation_letter_templates for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE:admin のみ
drop policy if exists "Admins can insert recommendation letter templates"
  on public.recommendation_letter_templates;
create policy "Admins can insert recommendation letter templates"
  on public.recommendation_letter_templates for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can update recommendation letter templates"
  on public.recommendation_letter_templates;
create policy "Admins can update recommendation letter templates"
  on public.recommendation_letter_templates for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can delete recommendation letter templates"
  on public.recommendation_letter_templates;
create policy "Admins can delete recommendation letter templates"
  on public.recommendation_letter_templates for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
