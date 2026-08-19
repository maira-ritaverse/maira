-- =====================================================================
-- トライアル終了通知の冪等マーカーを organization_plans に追加(M8 修正)
--
-- 背景:
--   trial-notifications cron は status='trialing' かつ trial_ends_at が
--   6〜8 日後 / 0〜2 日後 のウィンドウに入る組織へメールを送るが、送信済み
--   マーカーが無いため、毎時 cron のたびに同じ組織が窓に一致し、しきい値ごと
--   に約 48 通の重複メールが送られていた。
--
--   しきい値(7 日前 / 1 日前)ごとに「通知済み時刻」を記録し、未通知の組織
--   だけを対象にすることで 1 しきい値 = 1 通に収める。
--
--   ※ トライアルが延長されて trial_ends_at が動いた場合、旧マーカーが残り
--     再通知されない稀な edge がある。頻度が低いため許容し、必要時は手動リセット。
-- =====================================================================

alter table public.organization_plans
  add column if not exists trial_notified_7d_at timestamptz,
  add column if not exists trial_notified_1d_at timestamptz;

comment on column public.organization_plans.trial_notified_7d_at is 'トライアル終了7日前通知を送った時刻(冪等マーカー。NULL=未通知)。';
comment on column public.organization_plans.trial_notified_1d_at is 'トライアル終了1日前通知を送った時刻(冪等マーカー。NULL=未通知)。';
