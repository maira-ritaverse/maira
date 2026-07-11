-- ============================================
-- Lステップ 相当 MA 拡張:Flow / Flow Steps / Flow Subscriptions
--
-- 既存 ma_scenarios (単発 トリガー = 1 通) を 発展 させ、
-- 多段 ステップ + 分岐 + 目標 達成 判定 を 表現 する 新 体系。
--
-- Phase 0 では スキーマ 投入 のみ、 dispatcher は 未実装 (旧 line-dispatch 並走)。
-- Phase 1 で /api/internal/ma/flow-dispatch を 追加 し 新 系統 で 配信。
--
-- 詳細 設計 :   docs/line-lstep-ma-design.md
-- 方針      :   docs/adr/0007-line-lstep-ma-flow.md
-- Phase 0 計画 : docs/line-lstep-ma-phase0-plan.md
-- ============================================

-- ────────────────────────────────────────
-- 1. ma_flows (多段 シナリオ 本体)
-- ────────────────────────────────────────
create table if not exists public.ma_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  channel text not null default 'line'
    check (channel in ('line')),
  -- トリガー 種別。 詳細 は design doc §4.1 参照
  trigger_type text not null check (trigger_type in (
    'friend_added',
    'tag_assigned',
    'tag_removed',
    'segment_matched',
    'form_submitted',
    'postback_received',
    'keyword_matched',
    'conversion_event',
    'manual'
  )),
  -- trigger 種別 ごと の 詳細 条件 (tag_id / event_key / postback_data_prefix 等)
  trigger_config jsonb not null default '{}'::jsonb,
  -- 起動時 の セグメント 一致 必須 (nullable)。
  -- Phase 1 で line_segments テーブル 追加 後 に FK 制約 を 張る。
  target_segment_id uuid,
  -- 目標 イベント。 達成 で subscription を goal_achieved に
  goal_event_key text,
  -- 一度 完了 / 中断 した 友達 を 再度 エンロール 可能 か
  allow_reentry boolean not null default false,
  -- 1 日 の 送信 上限 (通数 コスト 対策)
  max_send_per_day integer,
  -- 送信 時間帯 制約 : {"only_between":{"start":"09:00","end":"20:00","tz":"Asia/Tokyo"}}
  send_time_window_json jsonb,
  is_active boolean not null default false,
  -- どの プリセット から 生成 された か (nullable、 手動 作成 は null)
  origin_preset_key text,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.ma_flows is
  '多段 シナリオ 本体。 Lステップ 相当 の Flow 定義。';
comment on column public.ma_flows.origin_preset_key is
  'lib/ma/flow-presets.ts の どの 定義 から 生成 された か。 手動 作成 flow は null。';
comment on column public.ma_flows.goal_event_key is
  'ma_conversion_events.event_key と 突合 する 目標 イベント。 達成 で subscription 中断。';
comment on column public.ma_flows.target_segment_id is
  'Phase 1 で line_segments を 追加 後 に FK を 張る。 現時点 は uuid 列 のみ。';

create index if not exists idx_ma_flows_org_active
  on public.ma_flows(organization_id, is_active);
create index if not exists idx_ma_flows_trigger
  on public.ma_flows(trigger_type, is_active)
  where is_active = true;

alter table public.ma_flows enable row level security;

create policy mf_select
  on public.ma_flows for select
  using (organization_id = public.current_user_organization_id());
create policy mf_admin_insert
  on public.ma_flows for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mf_admin_update
  on public.ma_flows for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mf_admin_delete
  on public.ma_flows for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_flows_updated_at on public.ma_flows;
create trigger set_ma_flows_updated_at
  before update on public.ma_flows
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 2. ma_flow_steps (Flow 内 ステップ)
-- ────────────────────────────────────────
create table if not exists public.ma_flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.ma_flows(id) on delete cascade,
  step_order integer not null check (step_order >= 1),
  name text,
  -- 前 ステップ から の 遅延 秒。 step_order=1 は trigger から の 遅延。
  delay_from_previous_seconds bigint not null default 0
    check (delay_from_previous_seconds >= 0),
  action_type text not null check (action_type in (
    'send_message',
    'assign_tag',
    'remove_tag',
    'add_score',
    'set_field',
    'wait',
    'branch',
    'stop'
  )),
  action_config jsonb not null default '{}'::jsonb,
  template_id uuid references public.ma_templates(id),
  -- action=branch の とき 必須
  branch_condition_json jsonb,
  next_step_on_true integer,
  next_step_on_false integer,
  -- branch 以外 で 両 null なら step_order+1、 それ 以外 なら 指定 先 へ
  next_step_on_default integer,
  -- このステップ 到達時 に goal 達成 判定 する か
  goal_check_on_entry boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (flow_id, step_order),
  -- send_message action は template_id 必須
  constraint mfs_send_message_needs_template
    check (action_type <> 'send_message' or template_id is not null),
  -- branch action は branch_condition_json 必須
  constraint mfs_branch_needs_condition
    check (action_type <> 'branch' or branch_condition_json is not null)
);

comment on table public.ma_flow_steps is
  'Flow 内 の 1 ステップ (送信 / タグ 付与 / 分岐 / スコア 加算 等)。';

create index if not exists idx_ma_flow_steps_flow
  on public.ma_flow_steps(flow_id, step_order);
create index if not exists idx_ma_flow_steps_template
  on public.ma_flow_steps(template_id)
  where template_id is not null;

alter table public.ma_flow_steps enable row level security;

-- flow_id 経由 で org を 引く ため EXISTS 節 で 判定
create policy mfs_select
  on public.ma_flow_steps for select
  using (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
  );
create policy mfs_admin_insert
  on public.ma_flow_steps for insert
  with check (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
    and public.current_user_organization_role() = 'admin'
  );
create policy mfs_admin_update
  on public.ma_flow_steps for update
  using (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
    and public.current_user_organization_role() = 'admin'
  );
create policy mfs_admin_delete
  on public.ma_flow_steps for delete
  using (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_flow_steps_updated_at on public.ma_flow_steps;
create trigger set_ma_flow_steps_updated_at
  before update on public.ma_flow_steps
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 3. ma_flow_subscriptions (friend × Flow の 進行 状態)
-- ────────────────────────────────────────
create table if not exists public.ma_flow_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_id uuid not null references public.ma_flows(id) on delete cascade,
  -- line_user_links と 参照 する が FK は 張らない (未連携 友達 も 許容)
  line_user_id text not null,
  client_record_id uuid references public.client_records(id) on delete set null,
  current_step_order integer not null default 1,
  next_action_at timestamptz not null,
  status text not null default 'active' check (status in (
    'active', 'goal_achieved', 'completed', 'canceled', 'paused', 'failed'
  )),
  entered_via text not null default 'trigger_auto' check (entered_via in (
    'trigger_auto', 'manual', 'imported'
  )),
  entered_at timestamptz not null default now(),
  goal_achieved_at timestamptz,
  completed_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.ma_flow_subscriptions is
  'friend × Flow の 進行 状態。 cron が next_action_at を 走査 して 実行。';

-- 同 Flow に active/paused な subscription は 1 件 のみ
-- (allow_reentry=true でも 過去 の 完了 は 残す)
create unique index if not exists uniq_ma_flow_subscriptions_active
  on public.ma_flow_subscriptions(flow_id, line_user_id)
  where status in ('active', 'paused');

-- cron の 走査 用
create index if not exists idx_ma_flow_subscriptions_next
  on public.ma_flow_subscriptions(status, next_action_at)
  where status = 'active';

create index if not exists idx_ma_flow_subscriptions_org_user
  on public.ma_flow_subscriptions(organization_id, line_user_id, status);

alter table public.ma_flow_subscriptions enable row level security;

create policy mfsub_select
  on public.ma_flow_subscriptions for select
  using (organization_id = public.current_user_organization_id());
-- INSERT / UPDATE は 基本 service_role (dispatcher) 経由。
-- 手動 enroll / cancel の ため の admin 権限 のみ 許可。
create policy mfsub_admin_insert
  on public.ma_flow_subscriptions for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mfsub_admin_update
  on public.ma_flow_subscriptions for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mfsub_admin_delete
  on public.ma_flow_subscriptions for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_flow_subscriptions_updated_at on public.ma_flow_subscriptions;
create trigger set_ma_flow_subscriptions_updated_at
  before update on public.ma_flow_subscriptions
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 4. 既存 テーブル へ の 列 追加 (Phase 1 dispatcher で 使用)
-- ────────────────────────────────────────
alter table public.ma_send_logs
  add column if not exists ma_flow_step_id uuid references public.ma_flow_steps(id) on delete set null;

comment on column public.ma_send_logs.ma_flow_step_id is
  '新 Flow 体系 で 送信 された 場合 の 対応 step。 旧 ma_scenarios 経由 送信 は null。';

create index if not exists idx_ma_send_logs_flow_step
  on public.ma_send_logs(ma_flow_step_id)
  where ma_flow_step_id is not null;

alter table public.ma_click_links
  add column if not exists ma_flow_step_id uuid references public.ma_flow_steps(id) on delete set null;

create index if not exists idx_ma_click_links_flow_step
  on public.ma_click_links(ma_flow_step_id)
  where ma_flow_step_id is not null;
