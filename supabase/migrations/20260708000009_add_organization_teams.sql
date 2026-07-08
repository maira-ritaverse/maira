-- =====================================================================
-- 組織 内 チーム 分離 の 基盤 (Phase 1)
--
-- 目的:
--   大 規模 エージェント で 顧客 リスト を チーム 別 に 分離 する 機能。
--   「東京 チーム」 「IT 担当」 の ような 自由 な team を org 内 に 作り、
--   member と client を 多対多 で 紐付ける。 RLS で 完全 分離 を 実現。
--
-- モデル:
--   organization_teams          - team 定義 (org 内 で 一意 な name)
--   organization_team_members   - team ↔ member 多対多
--   client_team_assignments     - team ↔ client 多対多
--
-- 分離 の 段階 性:
--   ・移行 直後 は 全 client が 未 割当 → 全員 可視 (現状 と 同じ)
--   ・team を 作り 割当 を 始める と 段階 的 に 分離 が 効く
--   ・admin は 常に 全て 見え る (統括 用)
-- =====================================================================

-- ============================================
-- 1. organization_teams
-- ============================================
create table if not exists public.organization_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  /** UI 表示 用 の 色 (16 進 #RRGGBB)。 NULL は デフォルト グレー。 */
  color text,
  sort_order int not null default 0,
  created_by_member_id uuid
    references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

comment on table public.organization_teams is
  '組織 内 の チーム 定義。 顧客 と メンバー を 紐付けて 大 規模 エージェント の '
  'リスト 分離 を 行う (2026-07-08 追加)。';

create index if not exists idx_organization_teams_org
  on public.organization_teams (organization_id, sort_order);

drop trigger if exists set_organization_teams_updated_at
  on public.organization_teams;
create trigger set_organization_teams_updated_at
  before update on public.organization_teams
  for each row execute function public.set_updated_at();

alter table public.organization_teams enable row level security;

drop policy if exists ot_select on public.organization_teams;
create policy ot_select on public.organization_teams for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は RPC (SECURITY DEFINER) 経由 で 権限 チェック 込 みで 行う。
-- service_role は バイパス。


-- ============================================
-- 2. organization_team_members (team × member)
-- ============================================
create table if not exists public.organization_team_members (
  team_id uuid not null
    references public.organization_teams(id) on delete cascade,
  member_id uuid not null
    references public.organization_members(id) on delete cascade,
  /** member: 通常 メンバー、 lead: team 内 で 割当 変更 権限 を 持つ */
  role text not null default 'member'
    check (role in ('member', 'lead')),
  added_at timestamptz not null default now(),
  added_by_member_id uuid
    references public.organization_members(id) on delete set null,
  primary key (team_id, member_id)
);

comment on table public.organization_team_members is
  '組織 team ↔ member の 多対多。 1 メンバー が 複数 team に 所属 可。';

create index if not exists idx_org_team_members_member
  on public.organization_team_members (member_id);

alter table public.organization_team_members enable row level security;

drop policy if exists otm_select on public.organization_team_members;
create policy otm_select on public.organization_team_members for select
  using (
    exists (
      select 1 from public.organization_teams t
      where t.id = organization_team_members.team_id
        and t.organization_id = public.current_user_organization_id()
    )
  );


-- ============================================
-- 3. client_team_assignments (team × client)
-- ============================================
create table if not exists public.client_team_assignments (
  client_record_id uuid not null
    references public.client_records(id) on delete cascade,
  team_id uuid not null
    references public.organization_teams(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by_member_id uuid
    references public.organization_members(id) on delete set null,
  primary key (client_record_id, team_id)
);

comment on table public.client_team_assignments is
  '顧客 ↔ team の 多対多。 1 顧客 が 複数 team に 属する 可能性 あり。 '
  'RLS で 「同 team の member のみ 可視」 を 実現。';

create index if not exists idx_client_team_assignments_team
  on public.client_team_assignments (team_id);

alter table public.client_team_assignments enable row level security;

drop policy if exists cta_select on public.client_team_assignments;
create policy cta_select on public.client_team_assignments for select
  using (
    exists (
      select 1 from public.organization_teams t
      where t.id = client_team_assignments.team_id
        and t.organization_id = public.current_user_organization_id()
    )
  );


-- ============================================
-- 4. client_records の SELECT RLS を team 分離 対応 に 拡張
--
-- 経路 (いずれ か を 満たせば 可視):
--   (a) 呼び 出し 者 が 組織 admin
--   (b) 顧客 が どの team にも 未 割当 (= legacy pool、 段階 移行 用)
--   (c) 顧客 の 所属 team に 呼び 出し 者 も 所属 (完全 分離 の 本体)
-- ============================================
-- 既存 の SELECT policy を まず 特定 して drop。 20260531000001 の 命名 を 参考。
drop policy if exists "Members can view organization clients"
  on public.client_records;

create policy "cr_select_team_scoped"
  on public.client_records for select
  using (
    organization_id = public.current_user_organization_id()
    and (
      -- (a) 組織 admin は 全 顧客 可視
      exists (
        select 1 from public.organization_members om
        where om.user_id = auth.uid()
          and om.organization_id = public.client_records.organization_id
          and om.role = 'admin'
      )
      -- (b) 顧客 が どの team にも 未 割当 (段階 移行 の 中 で 従来 動作 を 維持)
      or not exists (
        select 1 from public.client_team_assignments cta
        where cta.client_record_id = public.client_records.id
      )
      -- (c) 顧客 の 所属 team に 呼び 出し 者 も 所属
      or exists (
        select 1
        from public.client_team_assignments cta
        join public.organization_team_members otm on otm.team_id = cta.team_id
        join public.organization_members om on om.id = otm.member_id
        where cta.client_record_id = public.client_records.id
          and om.user_id = auth.uid()
      )
    )
  );

comment on policy "cr_select_team_scoped" on public.client_records is
  'team 分離 対応 の SELECT ポリシー。 admin / 未 割当 pool / team 共有 の '
  'いずれ か で 可視 (2026-07-08)。';
