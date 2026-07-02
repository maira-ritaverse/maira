-- =====================================================================
-- Stripe 席 数 同期 失敗 の リトライ キュー
--
-- 目的:
--   ・「メンバー 招待 受諾 直後」 に Stripe API が 落ちた ケース で、
--     Extra Seat quantity の 更新 を 諦めず に リトライ する
--   ・指数 バック オフ (5min → 30min → 6h → 24h) で 復旧
--   ・cron (/api/internal/billing/seat-reconcile) が pending 行 を 拾う
--
-- RLS: service_role のみ (Maira 運営 が 直接 SQL で 監視 する 用途 も 想定)
-- =====================================================================

create table if not exists public.seat_sync_failures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  target_quantity int not null,
  error_message text not null,
  retry_count int not null default 0,
  next_retry_at timestamptz not null default now() + interval '5 minutes',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.seat_sync_failures is
  'Extra Seat quantity 更新 が Stripe 側 で 失敗 した 際 の リトライ キュー。 cron が 拾う。';

comment on column public.seat_sync_failures.target_quantity is
  '同期 したかった quantity (= max(0, seat_count - 3))';

comment on column public.seat_sync_failures.next_retry_at is
  '次回 リトライ 時刻。 指数 バック オフ (5min → 30min → 6h → 24h) で 更新。';

comment on column public.seat_sync_failures.resolved_at is
  'リトライ 成功 時 の 時刻。 NULL = 未 解決 (pending)。';

-- 未 解決 の 行 を 効率 的 に 拾う
create index if not exists idx_seat_sync_failures_pending
  on public.seat_sync_failures (next_retry_at)
  where resolved_at is null;

-- 組織 別 に 履歴 を 見る 用
create index if not exists idx_seat_sync_failures_org
  on public.seat_sync_failures (organization_id, created_at desc);

alter table public.seat_sync_failures enable row level security;

-- RLS ポリシー は 作らない = service_role のみ
