-- =====================================================================
-- アドオン(オプション機能)契約管理 subscription_addons
--
-- 目的:
--   ・基本プラン外の「オプション機能」の有効/無効を 1 ユーザあたり管理
--   ・最初の対象は「会議録音 自動連携」(Zoom Cloud Recording / Google Meet
--     Drive 連携で録画を自動取り込み → 履歴書/職務経歴書を自動生成)
--   ・手動アップロードは基本プラン側に残し、月次回数制限のみ運用するため
--     ここでは扱わない(回数は career_intake_recordings の created_at で集計)
--
-- 設計の意図(ADR 不要、要約):
--   ・将来 Stripe Subscription Items と 1:1 で紐づけたいので
--     stripe_subscription_item_id を持つ
--   ・状態は active/past_due/canceled の 3 値で Stripe の状態を反映
--   ・1 ユーザ 1 アドオン につき 1 行(unique 制約)
--   ・本人は閲覧可、書込は service_role(Stripe Webhook 経由)のみ
-- =====================================================================

create table if not exists public.subscription_addons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- アドオン識別子。将来増やすときは check 制約に追加していく
  addon_key text not null check (addon_key in ('meeting_recording_auto')),
  -- 状態は Stripe の subscription_item.status をそのまま反映する想定
  status text not null default 'active'
    check (status in ('active', 'past_due', 'canceled')),
  -- Stripe 側の subscription_item id(将来の Webhook 紐付け用)
  stripe_subscription_item_id text,
  -- 当該アドオンの当該課金期間の期限。期限切れ後は active 表示しない
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 1 ユーザ × 1 アドオンキー = 1 行
  unique (user_id, addon_key)
);

create index if not exists subscription_addons_user_idx
  on public.subscription_addons (user_id);

create index if not exists subscription_addons_stripe_item_idx
  on public.subscription_addons (stripe_subscription_item_id);

comment on table public.subscription_addons is
  'オプション機能(アドオン)契約。Stripe Subscription Items と 1:1 で紐づく前提';

-- ───────────────────────────────────────────────────────────────────
-- RLS:本人 SELECT のみ。INSERT/UPDATE/DELETE は service_role 限定。
-- ───────────────────────────────────────────────────────────────────
alter table public.subscription_addons enable row level security;

drop policy if exists subscription_addons_self_select
  on public.subscription_addons;
create policy subscription_addons_self_select
  on public.subscription_addons
  for select
  using (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE は service_role のみ:
-- 通常クライアントには明示的にポリシーを作らないので、デフォルトで弾かれる
-- (subscriptions テーブルと同じ運用方針)

-- updated_at を自動更新(共通トリガがあればそれを使う、無ければ書き捨て)
create or replace function public.subscription_addons_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscription_addons_touch_updated_at_trg
  on public.subscription_addons;
create trigger subscription_addons_touch_updated_at_trg
  before update on public.subscription_addons
  for each row execute function public.subscription_addons_touch_updated_at();
