-- ============================================
-- エージェント側CRM:対応履歴 + タスク管理
--
-- エージェント企業がクライアント(求職者)に対して行う
--   1) 対応履歴(client_interactions)
--   2) タスク(agency_tasks)
-- を管理するための2テーブルを追加する。
--
-- 設計方針:
--   - 平文。求職者本人のメッセージなどの「ユーザー資産」とは別物で、
--     エージェント企業が業務上記録する「企業所有データ」のため、
--     既存の client_records.notes と整合させて平文で保存する。
--   - 既存 public.tasks(求職者向けの暗号化タスク)とは別テーブルとし、
--     enum もそちらの task_status とは混ぜない(衝突回避)。
--   - referral_id は NULLABLE(求人と紐づかない接触履歴・タスクを許容)。
--   - RLS は client_records / referrals と同じ
--     SECURITY DEFINER ヘルパーパターンで組み、無限再帰を回避する。
-- ============================================

-- ============================================
-- 1. client_interactions(対応履歴)
-- ============================================
-- なぜ enum でなく text + check:
--   referrals.status と同じ方針で、将来「企業ごとにタイプを
--   カスタマイズしたい」要件が来た時に check を外して
--   マスター参照に置き換えやすくするため。
create table if not exists public.client_interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- どのクライアント・どの紹介に対する対応か
  -- referral_id は NULL 可(求人と紐づかない対応履歴を許容)
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  referral_id uuid references public.referrals(id) on delete set null,

  -- 記録者(担当アドバイザー)
  -- メンバーが削除されても履歴自体は残したいので set null
  author_member_id uuid references public.organization_members(id) on delete set null,

  -- 対応の種類
  interaction_type text not null
    check (interaction_type in ('call', 'email', 'meeting', 'message', 'note', 'other')),

  -- 「対応した日時」と「記録した日時」は別物。
  -- 過去日付の対応を後から記録するケースを想定して occurred_at を持つ。
  occurred_at timestamptz not null default now(),

  -- 一覧で見える短い要約と、詳細メモ
  summary text,
  body text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.client_interactions is 'エージェント企業の対応履歴(平文、企業所有)';
comment on column public.client_interactions.occurred_at is '対応した日時(記録日時とは別)';
comment on column public.client_interactions.referral_id is 'NULL可。求人と紐づかない対応履歴を許容';

-- クライアント詳細画面で「最近の対応履歴を新しい順」が主クエリ
create index if not exists idx_client_interactions_client
  on public.client_interactions(client_record_id);
create index if not exists idx_client_interactions_occurred
  on public.client_interactions(occurred_at desc);
create index if not exists idx_client_interactions_org
  on public.client_interactions(organization_id);

alter table public.client_interactions enable row level security;

-- RLS(client_records と同じ4ポリシー)
-- SECURITY DEFINER ヘルパー経由で再帰回避(20260531000002 で導入したパターン)。
create policy "Members can view interactions in their organization"
  on public.client_interactions for select
  using (organization_id = public.current_user_organization_id());

create policy "Members can insert interactions in their organization"
  on public.client_interactions for insert
  with check (organization_id = public.current_user_organization_id());

create policy "Members can update interactions in their organization"
  on public.client_interactions for update
  using (organization_id = public.current_user_organization_id());

create policy "Admins can delete interactions in their organization"
  on public.client_interactions for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- updated_at トリガー(set_updated_at は 20260530000001 で作成済み)
drop trigger if exists set_client_interactions_updated_at on public.client_interactions;
create trigger set_client_interactions_updated_at
  before update on public.client_interactions
  for each row execute function public.set_updated_at();


-- ============================================
-- 2. agency_tasks(エージェント業務タスク)
-- ============================================
-- なぜ既存 task_status enum を使わない:
--   public.tasks(求職者向け)は 'pending/done/skipped/overdue' という
--   ユーザー伴走文脈の enum。エージェントの業務タスクは pending/completed の
--   シンプルな2状態で十分かつ意味が違うため、text + check で分離する。
--   将来ステータスを増やしたい場合も text なら拡張しやすい。
create table if not exists public.agency_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- どのクライアント・どの紹介に対するタスクか
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  referral_id uuid references public.referrals(id) on delete set null,

  -- 担当者は必須(誰がやるか決まらないタスクは作らせない)
  -- 担当者が抜けた場合は再割当が必要になるため、ここは set null ではなく
  -- restrict 相当の運用方針(再割当 UI でカバー)を想定して references のみ
  assigned_member_id uuid not null references public.organization_members(id),

  title text not null,

  -- pending/completed のシンプル2状態
  status text not null default 'pending'
    check (status in ('pending', 'completed')),

  -- 任意:high/normal/low
  priority text check (priority in ('high', 'normal', 'low')),

  -- 期限アラート用
  due_at timestamptz,
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agency_tasks is 'エージェント業務タスク(平文、企業所有)。public.tasks(求職者向け)とは別物';
comment on column public.agency_tasks.assigned_member_id is '担当アドバイザー。NOT NULL(無担当タスクは禁止)';
comment on column public.agency_tasks.status is 'pending/completed のシンプル2状態(public.tasks の task_status とは別)';

-- 期限アラート用(未完了タスクを期限順にスキャン)
create index if not exists idx_agency_tasks_pending_due
  on public.agency_tasks(due_at)
  where status = 'pending';

-- クライアント詳細画面でタスク一覧を表示する用
create index if not exists idx_agency_tasks_client
  on public.agency_tasks(client_record_id);

-- 担当者ダッシュボード用
create index if not exists idx_agency_tasks_assignee
  on public.agency_tasks(assigned_member_id);

create index if not exists idx_agency_tasks_org
  on public.agency_tasks(organization_id);

alter table public.agency_tasks enable row level security;

-- RLS(client_records / referrals と同じ4ポリシー)
create policy "Members can view tasks in their organization"
  on public.agency_tasks for select
  using (organization_id = public.current_user_organization_id());

create policy "Members can insert tasks in their organization"
  on public.agency_tasks for insert
  with check (organization_id = public.current_user_organization_id());

create policy "Members can update tasks in their organization"
  on public.agency_tasks for update
  using (organization_id = public.current_user_organization_id());

create policy "Admins can delete tasks in their organization"
  on public.agency_tasks for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- updated_at トリガー
drop trigger if exists set_agency_tasks_updated_at on public.agency_tasks;
create trigger set_agency_tasks_updated_at
  before update on public.agency_tasks
  for each row execute function public.set_updated_at();
