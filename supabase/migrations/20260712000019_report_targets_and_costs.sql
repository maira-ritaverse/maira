-- ============================================
-- レポート:月次目標 + 月次コスト(ROI 計算用)
--
-- 用途:
--   ・report_targets: 月次目標(成約件数・純売上・応募・面談の 4 指標)
--     → 「目標達成率」セクションで KPI と並列表示
--   ・report_costs: 月次コスト(マーケ・ツール・人件・その他)
--     → ROI = (純売上 - コスト合計) / コスト合計 × 100%
--
-- 管理:
--   ・両テーブルとも admin だけが INSERT / UPDATE / DELETE
--   ・組織メンバー全員が SELECT(レポート閲覧のため)
--   ・year_month は YYYY-MM 形式(月次で 1 行)
-- ============================================

-- report_targets
create table if not exists public.report_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  -- YYYY-MM 形式(例:2026-07)。 organization_id と組合わせて unique
  year_month text not null,

  placement_count_target integer not null default 0,
  net_revenue_target integer not null default 0,
  application_count_target integer not null default 0,
  interview_count_target integer not null default 0,

  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (organization_id, year_month),
  check (year_month ~ '^\d{4}-\d{2}$')
);

comment on table public.report_targets is
  '月次目標(成約 / 売上 / 応募 / 面談)。 レポート「目標達成率」で使用。';

create index if not exists idx_report_targets_org_month
  on public.report_targets (organization_id, year_month desc);

alter table public.report_targets enable row level security;

-- SELECT: 組織メンバー全員
create policy "report_targets_select"
  on public.report_targets for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE: admin のみ
create policy "report_targets_insert_admin"
  on public.report_targets for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "report_targets_update_admin"
  on public.report_targets for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "report_targets_delete_admin"
  on public.report_targets for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- report_costs
create table if not exists public.report_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  year_month text not null,

  -- 4 種類のコスト。 admin が任意の粒度で入れる
  marketing_cost integer not null default 0,
  tool_cost integer not null default 0,
  personnel_cost integer not null default 0,
  other_cost integer not null default 0,

  -- 内訳メモ(admin 用の備忘)
  memo text,

  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (organization_id, year_month),
  check (year_month ~ '^\d{4}-\d{2}$')
);

comment on table public.report_costs is
  '月次コスト(マーケ / ツール / 人件 / その他)。 ROI = (純売上 - コスト合計) / コスト合計 で計算。';

create index if not exists idx_report_costs_org_month
  on public.report_costs (organization_id, year_month desc);

alter table public.report_costs enable row level security;

create policy "report_costs_select"
  on public.report_costs for select
  using (organization_id = public.current_user_organization_id());

create policy "report_costs_insert_admin"
  on public.report_costs for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "report_costs_update_admin"
  on public.report_costs for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "report_costs_delete_admin"
  on public.report_costs for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
