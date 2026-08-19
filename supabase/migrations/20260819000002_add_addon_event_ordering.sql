-- =====================================================================
-- subscription_addons にイベント順序ガード用の時刻列を追加(M6 修正)
--
-- 背景:
--   org サブスクの同期(handleSubscriptionSync)は RPC で last_synced_at の
--   ハイウォーターマークを持ち、Stripe イベントの順不同配信に強い。一方 addon
--   経路(handleAddonSubscription)は素の upsert で順序ガードが無く、
--   'active' 更新が 'canceled' の後に処理されると status が active に戻り、
--   キャンセル済みの有料機能(会議録音)が復活し得た。
--
--   直近に適用した Stripe イベントの created(発生時刻)を記録し、より古い
--   イベントは無視することで順不同配信でも状態が巻き戻らないようにする。
-- =====================================================================

alter table public.subscription_addons
  add column if not exists last_event_created_at timestamptz;

comment on column public.subscription_addons.last_event_created_at is '直近に適用した Stripe イベントの created 時刻。これより古いイベントは順序ガードで無視する。';
