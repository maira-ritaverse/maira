-- =====================================================================
-- subscription_addons.stripe_customer_id を追加
--
-- Stripe Customer Portal(解約 / 支払方法管理)を本人が開くために、
-- アドオン契約者の customer_id を保管する必要がある。
-- Webhook 受信時に sub.customer から読み取って upsert する。
-- =====================================================================

alter table public.subscription_addons
  add column if not exists stripe_customer_id text;

create index if not exists subscription_addons_customer_idx
  on public.subscription_addons (stripe_customer_id);
