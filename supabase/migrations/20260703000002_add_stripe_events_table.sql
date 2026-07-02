-- =====================================================================
-- Stripe Webhook idempotency 台帳 テーブル
--
-- 目的:
--   ・受信 した Stripe event.id を PK に 記録 し、 二重 処理 を 弾く
--   ・失敗 / 成功 / 無視 の 状態 を 台帳 と して 監査 対応 に 使う
--   ・24h 経過 で 'received' の まま の 行 は 処理 中 に 落ちた 疑い
--     (別 タスク で Sentry 監視)
--
-- RLS: service_role のみ (Webhook ハンドラ 経由)。 一般 ユーザー は SELECT 不可。
-- =====================================================================

create table if not exists public.stripe_events (
  id text primary key,                 -- Stripe event.id (evt_xxx)
  type text not null,                  -- event.type
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  error_message text
);

comment on table public.stripe_events is
  'Stripe Webhook の idempotency 兼 監査 台帳。 event.id を PK に 二重 処理 を 防ぐ。';

comment on column public.stripe_events.status is
  'received (受信 直後) / processed (成功) / ignored (対象 外) / failed (エラー)';

create index if not exists idx_stripe_events_type_received
  on public.stripe_events (type, received_at desc);

-- 監視 用: 'received' の まま で 24h 以上 経過 して いる 行 を 拾う
create index if not exists idx_stripe_events_stale_received
  on public.stripe_events (received_at)
  where status = 'received';

alter table public.stripe_events enable row level security;

-- RLS ポリシー は 作らない = service_role のみ が アクセス できる 状態 に する。
-- 一般 ユーザー が 直接 触る 必要 は なく、 admin 画面 で 見る 場合 も
-- service_role を 使う ルート で 露出 する 想定。
