-- ============================================
-- 求人情報(エージェント企業所有)
--
-- エージェント企業がクライアント(求職者)に紹介するための求人を管理する。
-- client_records と同じ「企業所有」のテナント分離パターン。
-- ============================================

create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- 求人基本情報
  company_name text not null,        -- 求人企業名
  position text not null,            -- 職種・ポジション
  employment_type text,              -- 雇用形態(正社員/契約/etc)
  location text,                     -- 勤務地
  salary_min integer,                -- 年収下限(万円)
  salary_max integer,                -- 年収上限(万円)

  -- 求人詳細
  description text,                  -- 仕事内容
  required_skills text,              -- 必須条件
  preferred_skills text,             -- 歓迎条件

  -- 募集ステータス
  status text not null default 'open'
    check (status in ('open', 'paused', 'closed')),

  -- 登録者(organization_members への参照)
  -- メンバーが退職して member 行が消えても求人自体は残したいので set null
  created_by_member_id uuid references public.organization_members(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_postings is 'エージェント企業が管理する求人情報';
comment on column public.job_postings.status is 'open(募集中) / paused(停止) / closed(終了)';
comment on column public.job_postings.salary_min is '年収下限(万円単位)';
comment on column public.job_postings.salary_max is '年収上限(万円単位)';

create index if not exists idx_job_postings_org_id on public.job_postings(organization_id);
create index if not exists idx_job_postings_status on public.job_postings(status);

alter table public.job_postings enable row level security;

-- ============================================
-- RLS ポリシー
--
-- 20260531000002 で導入した SECURITY DEFINER ヘルパー関数を使い、
-- organization_members の自己参照による無限再帰(42P17)を回避する。
--   - public.current_user_organization_id()    : 現ユーザーの所属企業ID
--   - public.current_user_organization_role()  : 現ユーザーのロール(admin/advisor)
-- ============================================

-- 閲覧:同じ企業のメンバーは自社の求人を見られる
create policy "Members can view jobs in their organization"
  on public.job_postings for select
  using (organization_id = public.current_user_organization_id());

-- 追加:同じ企業のメンバーは自社に求人を登録できる
create policy "Members can insert jobs in their organization"
  on public.job_postings for insert
  with check (organization_id = public.current_user_organization_id());

-- 更新:同じ企業のメンバーは自社の求人を更新できる
create policy "Members can update jobs in their organization"
  on public.job_postings for update
  using (organization_id = public.current_user_organization_id());

-- 削除:管理者のみ、自社の求人を削除できる
create policy "Admins can delete jobs in their organization"
  on public.job_postings for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ============================================
-- updated_at トリガー
-- (set_updated_at 関数は 20260530000001 で作成済み)
-- ============================================
drop trigger if exists set_job_postings_updated_at on public.job_postings;
create trigger set_job_postings_updated_at
  before update on public.job_postings
  for each row execute function public.set_updated_at();
