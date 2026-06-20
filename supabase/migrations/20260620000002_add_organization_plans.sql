-- ============================================
-- エージェント企業 課金プラン(organization_plans)
--
-- 仕様: docs/agency-billing-design.md
--
-- 構造:
--   ・1 組織 = 1 行(PRIMARY KEY: organization_id)
--   ・tier:standard / standard_rec / standard_pro / standard_premium(排他)
--   ・cycle:monthly / yearly
--   ・trial_started_at / trial_ends_at:無料期間 (デフォルト 30 日)
--   ・status:trialing → active → past_due / canceled
--   ・stripe_* 系は Phase 7 (Stripe 契約後) に 埋める。 当面 NULL 許容。
--
-- 書き込み方針:
--   ・SELECT は 同 org メンバー(advisor 含む)が 自組織分のみ
--   ・INSERT / UPDATE は SECURITY DEFINER RPC 経由 のみ
--     (Stripe Webhook は service_role 直接 INSERT/UPDATE する 想定)
--
-- 既存 organization_ai_quotas との 関係:
--   ・organization_ai_quotas は 「kind 別 上限の admin 上書き」
--   ・organization_plans.tier で 「プラン由来 の +500 ボーナス」を 加算
--   ・両者 は 独立。 計算は アプリ側 (lib/billing/agency.ts) で 合算
-- ============================================

-- ============================================
-- 1. ENUM 型
-- ============================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_plan_tier') then
    create type public.organization_plan_tier as enum (
      'standard',          -- 基本のみ (¥25,000 + ¥3,980/4人目以降、AI 500回)
      'standard_rec',      -- + 録音 オプション (+¥10,000)
      'standard_pro',      -- + Pro (+¥4,200、AI 1,000回)
      'standard_premium'   -- + Premium (+¥12,000、AI 1,000回 + 録音)
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_billing_cycle') then
    create type public.organization_billing_cycle as enum (
      'monthly',
      'yearly'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_plan_status') then
    create type public.organization_plan_status as enum (
      'trialing',     -- 無料期間中
      'active',       -- 通常課金中
      'past_due',     -- 課金失敗 (リトライ中)
      'canceled',     -- 解約済 (期末まで 利用可能、 期末で 失効)
      'incomplete'    -- 初期 setup 未完 (Stripe SCA 等)
    );
  end if;
end$$;


-- ============================================
-- 2. organization_plans テーブル
-- ============================================
create table if not exists public.organization_plans (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,

  -- プラン構成
  tier public.organization_plan_tier not null default 'standard',
  cycle public.organization_billing_cycle not null default 'monthly',

  -- 無料期間
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_upgrade_choice public.organization_plan_tier,
    -- ↑ トライアル中に「終了後 継続したい アップグレード」を 顧客が 選択した値。
    --   NULL なら Standard のみ (アップグレード 解除)。

  -- 課金 サイクル
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billed_at timestamptz,
  canceled_at timestamptz,
    -- ↑ 解約予約 が 入った 時刻。 current_period_end で 実失効。

  -- Stripe (Phase 7 で 埋める)
  stripe_customer_id text unique,
  stripe_subscription_id text unique,

  -- 状態
  status public.organization_plan_status not null default 'trialing',

  -- メタ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organization_plans is
  'エージェント企業の 課金プラン。1 組織 1 行。Stripe Subscription と 1:1 対応 (契約後)。';

comment on column public.organization_plans.tier is
  '排他の プランティア。standard / standard_rec / standard_pro / standard_premium。';

comment on column public.organization_plans.trial_upgrade_choice is
  'トライアル終了時に 継続したい アップグレード (NULL なら Standard のみに 戻る)。';


-- ============================================
-- 3. インデックス
-- ============================================
create index if not exists idx_org_plans_status
  on public.organization_plans(status);

create index if not exists idx_org_plans_trial_ends_at
  on public.organization_plans(trial_ends_at)
  where status = 'trialing';

create index if not exists idx_org_plans_next_billed_at
  on public.organization_plans(next_billed_at)
  where status = 'active';


-- ============================================
-- 4. updated_at 自動更新 トリガー
-- ============================================
create or replace function public.organization_plans_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_org_plans_updated_at on public.organization_plans;
create trigger trg_org_plans_updated_at
  before update on public.organization_plans
  for each row
  execute function public.organization_plans_set_updated_at();


-- ============================================
-- 5. RLS
-- ============================================
alter table public.organization_plans enable row level security;

-- SELECT: 同 org メンバー全員 (advisor 含む。料金透明性のため)
drop policy if exists op_select on public.organization_plans;
create policy op_select
  on public.organization_plans for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は service_role と SECURITY DEFINER RPC 経由のみ。
-- (Stripe Webhook ハンドラは service_role キー で 直接 操作)


-- ============================================
-- 6. RPC: get_my_organization_plan
--    現ユーザーの 所属組織の プラン情報を 返す。
--    未作成 (= NULL) の場合は 行が 返らない (呼び出し側で start_trial を 案内)。
-- ============================================
create or replace function public.get_my_organization_plan()
returns table (
  organization_id uuid,
  tier public.organization_plan_tier,
  cycle public.organization_billing_cycle,
  status public.organization_plan_status,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_upgrade_choice public.organization_plan_tier,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billed_at timestamptz,
  canceled_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
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
    p.trial_started_at,
    p.trial_ends_at,
    p.trial_upgrade_choice,
    p.current_period_start,
    p.current_period_end,
    p.next_billed_at,
    p.canceled_at,
    p.stripe_customer_id,
    p.stripe_subscription_id,
    p.created_at,
    p.updated_at
  from public.organization_plans p
  where p.organization_id = v_caller_org_id;
end;
$$;

comment on function public.get_my_organization_plan() is
  '自組織の 課金プラン 情報を 返す (未作成なら 0 行)。';


-- ============================================
-- 7. RPC: start_organization_trial
--    組織の admin が トライアルを 開始する。
--    既に 行が ある場合 (= 再開) は エラー (Stripe Customer ID 等を 上書きしないため)。
--    Phase 7 で Stripe Customer ID を 引数に 受け取るように 拡張する。
-- ============================================
create or replace function public.start_organization_trial(
  p_trial_days int default 30
)
returns public.organization_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_now timestamptz;
  v_plan public.organization_plans;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  -- admin だけが トライアル 開始可能
  select role into v_caller_role
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_trial_days < 0 or p_trial_days > 90 then
    raise exception 'invalid_trial_days' using errcode = 'P0001';
  end if;

  v_now := now();

  -- 既に レコードが 存在する場合は エラー (二重開始 防止)
  if exists (select 1 from public.organization_plans where organization_id = v_caller_org_id) then
    raise exception 'plan_already_exists' using errcode = 'P0001';
  end if;

  insert into public.organization_plans (
    organization_id,
    tier,
    cycle,
    status,
    trial_started_at,
    trial_ends_at,
    current_period_start,
    current_period_end
  ) values (
    v_caller_org_id,
    'standard',
    'monthly',
    'trialing',
    v_now,
    v_now + (p_trial_days || ' days')::interval,
    v_now,
    v_now + (p_trial_days || ' days')::interval
  )
  returning * into v_plan;

  return v_plan;
end;
$$;

comment on function public.start_organization_trial(int) is
  '自組織の トライアルを 開始する (admin のみ、 デフォルト 30 日)。';


-- ============================================
-- 8. RPC: set_trial_upgrade_choice
--    トライアル中の admin が 「トライアル終了後 継続したい アップグレード」を 選択する。
--    NULL を 渡せば 「Standard のみで 継続」(= アップグレード 解除)。
-- ============================================
create or replace function public.set_trial_upgrade_choice(
  p_choice public.organization_plan_tier
)
returns public.organization_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_plan public.organization_plans;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  -- admin だけが 選択可
  select role into v_caller_role
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  -- standard を 選んだら 「アップグレード解除」と 同義 (NULL に 倒す)
  update public.organization_plans
  set trial_upgrade_choice = case
        when p_choice = 'standard' then null
        else p_choice
      end
  where organization_id = v_caller_org_id
    and status = 'trialing'
  returning * into v_plan;

  if v_plan.organization_id is null then
    raise exception 'plan_not_trialing' using errcode = 'P0001';
  end if;

  return v_plan;
end;
$$;

comment on function public.set_trial_upgrade_choice(public.organization_plan_tier) is
  'トライアル終了後の アップグレード継続選択を 更新する (admin のみ、 trialing 中のみ)。';


-- ============================================
-- 9. RPC: admin_set_organization_plan_tier
--    Maira admin (運営者) が 任意の 組織の tier を 強制 設定する。
--    Stripe 契約 前の 手動 切替や 障害対応 用。
--    isMairaAdmin チェックは 呼び出し側 API で 実施し、 ここでは service_role 限定。
--
--    (SECURITY DEFINER だが auth.role() = 'service_role' を 要求する ことで
--     普通の Authenticated ユーザーから 呼ばれることを 防ぐ)
-- ============================================
create or replace function public.admin_set_organization_plan_tier(
  p_organization_id uuid,
  p_tier public.organization_plan_tier
)
returns public.organization_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.organization_plans;
begin
  -- service_role からの 呼び出し限定 (API が isMairaAdmin チェック後に 呼ぶ)
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  -- 既存行 が なければ 新規作成 (status=active で 開始、 trial スキップ)
  insert into public.organization_plans (
    organization_id, tier, cycle, status
  ) values (
    p_organization_id, p_tier, 'monthly', 'active'
  )
  on conflict (organization_id) do update set
    tier = excluded.tier,
    updated_at = now()
  returning * into v_plan;

  return v_plan;
end;
$$;

comment on function public.admin_set_organization_plan_tier(uuid, public.organization_plan_tier) is
  'Maira admin が 組織の tier を 強制 設定する (service_role 限定、 API で isMairaAdmin 検証必須)。';
