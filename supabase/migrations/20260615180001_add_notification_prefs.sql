-- =====================================================================
-- 個人別通知設定(organization_members.notification_prefs)
--
-- 通知の購読 / 解除をメンバー単位で管理する。
-- 同じユーザーが複数組織に所属する場合は組織ごとに独立した設定を持つ。
--
-- スキーマ:
--   JSONB。{"key": boolean} 形式。未知のキーが来ても無視する寛容モード。
--   デフォルトは全 ON("空オブジェクト" = 全 true 扱いを TS 側で実装)。
-- =====================================================================

alter table public.organization_members
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.organization_members.notification_prefs is
  '通知の購読設定(空オブジェクトは全 ON 扱い)。キーは TS 側 NotificationKey の値';
