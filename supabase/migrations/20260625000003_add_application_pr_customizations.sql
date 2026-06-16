-- =====================================================================
-- 求人ごとの履歴書/職務経歴書 PR カスタマイズ
--   application_pr_customizations
--
-- 目的:
--   ・同じ履歴書 / 職務経歴書をベースに、応募ごとに「志望動機」「自己 PR」だけ
--     差し替えて出すことが転職活動では多い
--   ・applications テーブルに 1:1 で紐づく形でカスタマイズ内容を保存する
--   ・本人(application owner)のみ閲覧 / 編集可
--
-- 設計:
--   ・1 application = 0 or 1 カスタマイズ(unique 制約)
--   ・base_resume_id / base_cv_id でベース文書を参照(別途取得時に「これに対する差分」と分かるよう)
--   ・カスタマイズ内容は AES-256-GCM 暗号化(applications と同じ機密区分)
--
-- セキュリティ:
--   ・本人のみ:auth.uid() = user_id
--   ・application.user_id と一致を二重チェック(API 側で)
-- =====================================================================

create table if not exists public.application_pr_customizations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- ベース文書(任意):取得時の表示に「どの履歴書/職務経歴書をベースに作ったか」を出すため
  base_resume_id uuid,
  base_cv_id uuid,
  -- 暗号化された差分 JSON(v{n}: 形式)
  --   { motivation_note?: string, self_pr?: string, notes?: string }
  encrypted_overrides text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apcu_user_idx
  on public.application_pr_customizations (user_id);

comment on table public.application_pr_customizations is
  '応募 1 件に紐づく「履歴書/職務経歴書の PR 差し替え」内容。本人のみ。';

alter table public.application_pr_customizations enable row level security;

drop policy if exists apcu_self_select on public.application_pr_customizations;
create policy apcu_self_select
  on public.application_pr_customizations
  for select using (auth.uid() = user_id);

drop policy if exists apcu_self_insert on public.application_pr_customizations;
create policy apcu_self_insert
  on public.application_pr_customizations
  for insert with check (auth.uid() = user_id);

drop policy if exists apcu_self_update on public.application_pr_customizations;
create policy apcu_self_update
  on public.application_pr_customizations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists apcu_self_delete on public.application_pr_customizations;
create policy apcu_self_delete
  on public.application_pr_customizations
  for delete using (auth.uid() = user_id);

create or replace function public.set_apcu_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_apcu_updated_at on public.application_pr_customizations;
create trigger set_apcu_updated_at
  before update on public.application_pr_customizations
  for each row execute function public.set_apcu_updated_at();
