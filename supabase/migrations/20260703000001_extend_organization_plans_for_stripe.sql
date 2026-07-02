-- =====================================================================
-- organization_plans を Stripe 組織 課金 (Standard / Pro) 対応 に 拡張
--
-- 目的:
--   ・単一 Stripe Subscription に 複数 Subscription Item (Base / Extra Seat
--     / AI Boost) を 束ねる 構成 を 表現 する
--   ・Webhook (invoice.paid / customer.subscription.updated 等) が
--     item 単位 で 状態 を 更新 できる よう、 item id を 個別 に 保持 する
--   ・Webhook の 順序 逆転 と 二重 配信 を 排除 する idempotency フィールド
--     (last_synced_at / last_stripe_event_id) を 追加 する
--
-- 前提:
--   ・cycle 列 は 既存 (organization_billing_cycle ENUM) を そのまま 使用
--   ・tier は 既存 4 値 の まま。今 契約 で 使う の は 'standard' と
--     'standard_pro' の 2 値 のみ (rec / premium は 現時点 未使用)
--   ・is_billing_exempt = true の 組織 は Webhook でも Item ID を 埋めない
--
-- 書き込み方針:
--   ・SELECT: 同 org メンバー (advisor 含む)。 料金 透明性 の ため。
--   ・INSERT / UPDATE / DELETE: service_role (= Stripe Webhook ハンドラ)
--     または SECURITY DEFINER RPC のみ。 通常 の Authenticated ユーザー は
--     直接 書き込め ない。
-- =====================================================================

-- ============================================
-- 1. 列 追加
-- ============================================
alter table public.organization_plans
  add column if not exists seat_count integer not null default 3,

  -- Stripe Subscription Item ID (単一 Subscription 内 の 各 item)
  add column if not exists stripe_subscription_item_id_base text,
  add column if not exists stripe_subscription_item_id_extra_seat text,
  add column if not exists stripe_subscription_item_id_ai_boost text,

  -- AI Boost の 有効 フラグ (tier=standard_pro と 論理 等価、 CHECK で 整合 保証)
  add column if not exists ai_boost_enabled boolean not null default false,

  -- Webhook idempotency
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_stripe_event_id text;

-- ============================================
-- 2. CHECK 制約
-- ============================================
-- 席 数 は 3 以上 (Base に 3 席 含まれる 仕様)
alter table public.organization_plans
  drop constraint if exists org_plans_seat_count_min_check;
alter table public.organization_plans
  add constraint org_plans_seat_count_min_check
  check (seat_count >= 3 and seat_count <= 1000);
  -- 上限 1000 は 現実 的 な 安全 弁 (Stripe quantity は 999,999 まで 許容 だが
  -- そこ まで 大きな 数字 は 別 契約 に する 想定)。

-- tier と ai_boost_enabled の 整合
--   standard_pro <=> ai_boost_enabled = true
--   それ 以外 (standard / standard_rec / standard_premium) は ai_boost_enabled は
--   常時 false で 統一 する
alter table public.organization_plans
  drop constraint if exists org_plans_ai_boost_matches_tier_check;
alter table public.organization_plans
  add constraint org_plans_ai_boost_matches_tier_check
  check (
    (tier = 'standard_pro' and ai_boost_enabled = true)
    or (tier <> 'standard_pro' and ai_boost_enabled = false)
  );

-- Stripe Subscription Item ID は 一意 (別 組織 に 同じ item ID が 割り当てられる
-- ことは 論理 的 に あり得 ない)
create unique index if not exists uq_org_plans_stripe_item_base
  on public.organization_plans (stripe_subscription_item_id_base)
  where stripe_subscription_item_id_base is not null;

create unique index if not exists uq_org_plans_stripe_item_extra_seat
  on public.organization_plans (stripe_subscription_item_id_extra_seat)
  where stripe_subscription_item_id_extra_seat is not null;

create unique index if not exists uq_org_plans_stripe_item_ai_boost
  on public.organization_plans (stripe_subscription_item_id_ai_boost)
  where stripe_subscription_item_id_ai_boost is not null;

-- ============================================
-- 3. コメント
-- ============================================
comment on column public.organization_plans.seat_count is
  '契約 中 の 席 数 (管理者 含む)。 3 席 まで Base に 含む、 4 以降 が Extra Seat 課金 対象。 Stripe の quantity を そのまま 反映。';

comment on column public.organization_plans.stripe_subscription_item_id_base is
  'Base 席 (Standard) の Stripe Subscription Item ID。 Webhook で 個別 item 更新 に 使用。';

comment on column public.organization_plans.stripe_subscription_item_id_extra_seat is
  'Extra Seat (4 席 目 以降) の Stripe Subscription Item ID。 quantity = seat_count - 3。';

comment on column public.organization_plans.stripe_subscription_item_id_ai_boost is
  'AI Boost の Stripe Subscription Item ID。 Pro (tier=standard_pro) 契約 中 のみ 非 NULL。';

comment on column public.organization_plans.ai_boost_enabled is
  'AI Boost の 有効 フラグ。 tier = standard_pro と 論理 等価 (CHECK で 保証)。';

comment on column public.organization_plans.last_synced_at is
  'Stripe Webhook で 最後 に 反映 した 時刻。 event の 順序 逆転 検知 に 使う。';

comment on column public.organization_plans.last_stripe_event_id is
  '最後 に 適用 した Stripe event の ID。 二重 配信 (at-least-once) に 対する idempotency ゲート。';

-- ============================================
-- 4. インデックス (運用 上 頻繁 に 引く キー)
-- ============================================
create index if not exists idx_org_plans_seat_count
  on public.organization_plans (seat_count)
  where status in ('active', 'trialing');

create index if not exists idx_org_plans_ai_boost_active
  on public.organization_plans (organization_id)
  where ai_boost_enabled = true and status in ('active', 'trialing');

-- ============================================
-- 5. get_my_organization_plan RPC の 返り 値 拡張
--
--   新規 追加 列 (seat_count / ai_boost_enabled / last_synced_at)
--   を フロント から 参照 できる よう に する。 stripe_subscription_item_id_*
--   は フロント では 使わ ない (Server 側 の Webhook 突合 用) の で 出さ ない。
--
--   PostgreSQL は create or replace で returns table の 定義 を 変更 でき
--   ない (42P13) ため、 一度 drop してから 作り直す。
-- ============================================
drop function if exists public.get_my_organization_plan();

create function public.get_my_organization_plan()
returns table (
  organization_id uuid,
  tier public.organization_plan_tier,
  cycle public.organization_billing_cycle,
  status public.organization_plan_status,
  seat_count integer,
  ai_boost_enabled boolean,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_upgrade_choice public.organization_plan_tier,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billed_at timestamptz,
  canceled_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  is_billing_exempt boolean,
  last_synced_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  return query
  select
    p.organization_id,
    p.tier,
    p.cycle,
    p.status,
    p.seat_count,
    p.ai_boost_enabled,
    p.trial_started_at,
    p.trial_ends_at,
    p.trial_upgrade_choice,
    p.current_period_start,
    p.current_period_end,
    p.next_billed_at,
    p.canceled_at,
    p.stripe_customer_id,
    p.stripe_subscription_id,
    p.is_billing_exempt,
    p.last_synced_at,
    p.created_at,
    p.updated_at
  from public.organization_plans p
  where p.organization_id = v_caller_org_id;
end;
$$;

comment on function public.get_my_organization_plan() is
  '自組織 の 課金 プラン 情報 を 返す (未 作成 なら 0 行)。 席 数 / AI Boost / 免除 フラグ を 含む。';

-- ============================================
-- 6. Webhook idempotency 適用 用 の SECURITY DEFINER RPC
--
--   Stripe Webhook ハンドラ (service_role) が 呼ぶ。 event ID と 時刻 で
--   古い / 重複 の event を 弾いた 上 で 状態 を 更新 する。
-- ============================================
create or replace function public.apply_stripe_subscription_sync(
  p_organization_id uuid,
  p_event_id text,
  p_event_created_at timestamptz,
  p_tier public.organization_plan_tier,
  p_cycle public.organization_billing_cycle,
  p_status public.organization_plan_status,
  p_seat_count integer,
  p_ai_boost_enabled boolean,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_item_base text,
  p_stripe_item_extra_seat text,
  p_stripe_item_ai_boost text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_next_billed_at timestamptz,
  p_canceled_at timestamptz
)
returns public.organization_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.organization_plans;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  -- idempotency: 同じ event を 二度 適用 しない
  select * into v_plan
  from public.organization_plans
  where organization_id = p_organization_id
  for update;

  if v_plan.organization_id is not null then
    if v_plan.last_stripe_event_id = p_event_id then
      return v_plan;
    end if;
    if v_plan.last_synced_at is not null
       and v_plan.last_synced_at > p_event_created_at then
      return v_plan;
    end if;
  end if;

  insert into public.organization_plans as p (
    organization_id,
    tier, cycle, status,
    seat_count, ai_boost_enabled,
    stripe_customer_id, stripe_subscription_id,
    stripe_subscription_item_id_base,
    stripe_subscription_item_id_extra_seat,
    stripe_subscription_item_id_ai_boost,
    current_period_start, current_period_end,
    next_billed_at, canceled_at,
    last_synced_at, last_stripe_event_id
  ) values (
    p_organization_id,
    p_tier, p_cycle, p_status,
    p_seat_count, p_ai_boost_enabled,
    p_stripe_customer_id, p_stripe_subscription_id,
    p_stripe_item_base, p_stripe_item_extra_seat, p_stripe_item_ai_boost,
    p_current_period_start, p_current_period_end,
    p_next_billed_at, p_canceled_at,
    p_event_created_at, p_event_id
  )
  on conflict (organization_id) do update set
    tier = excluded.tier,
    cycle = excluded.cycle,
    status = excluded.status,
    seat_count = excluded.seat_count,
    ai_boost_enabled = excluded.ai_boost_enabled,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, p.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, p.stripe_subscription_id),
    stripe_subscription_item_id_base = coalesce(excluded.stripe_subscription_item_id_base, p.stripe_subscription_item_id_base),
    stripe_subscription_item_id_extra_seat = coalesce(excluded.stripe_subscription_item_id_extra_seat, p.stripe_subscription_item_id_extra_seat),
    stripe_subscription_item_id_ai_boost = excluded.stripe_subscription_item_id_ai_boost,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    next_billed_at = excluded.next_billed_at,
    canceled_at = excluded.canceled_at,
    last_synced_at = excluded.last_synced_at,
    last_stripe_event_id = excluded.last_stripe_event_id,
    updated_at = now()
  returning * into v_plan;

  return v_plan;
end;
$$;

comment on function public.apply_stripe_subscription_sync(
  uuid, text, timestamptz, public.organization_plan_tier,
  public.organization_billing_cycle, public.organization_plan_status,
  integer, boolean, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz
) is
  'Stripe Webhook が 同期 用 に 呼ぶ。 event ID / 時刻 で idempotency を 保証。 service_role 限定。';
