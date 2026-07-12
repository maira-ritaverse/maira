-- ============================================
-- ma_flow_subscriptions.tick_failure_count 列を追加
--
-- 背景:
--   failWith が status も next_action_at も更新していなかったため、
--   壊れた受信者(Resend 400 / LINE 401 revoked token 等)を持つ subscription が
--   dispatcher の毎 tick で再ピックされ無限ループ・クレジット焼失していた
--
-- 修正:
--   失敗回数を数え、 MAX_TICK_FAILURES (3) に達したら status='failed' に遷移。
--   それまでは next_action_at を 1 時間 backoff して即時再ピックを止める。
--
-- default 0、 nullable(既存レコードは 0 として扱う)。
-- ============================================

alter table public.ma_flow_subscriptions
  add column if not exists tick_failure_count integer not null default 0;

comment on column public.ma_flow_subscriptions.tick_failure_count is
  'ステップ実行が連続で失敗した回数。 MAX_TICK_FAILURES 到達で status=failed に遷移する(flow-executor.failWith 参照)。';
