-- =====================================================================
-- 組織ごとの Slack 通知 Webhook URL
--
-- Incoming Webhook を 1 つ持たせて「内定 / 入社」など重要イベントを Slack に流す。
-- OAuth / ボットは導入しない(管理オーバーヘッドが大きい)。
--
-- セキュリティ:
--   - URL 自体は admin だけが SELECT / UPDATE できれば十分(平文)。
--   - RLS は organizations 全体で既に組織所属者だけが SELECT 可。
--     UPDATE は admin のみ。本マイグレーションでは「カラム追加」だけ行う
--     (既存の RLS ポリシーをそのまま活かす)。
-- =====================================================================

alter table public.organizations
  add column if not exists slack_webhook_url text;

comment on column public.organizations.slack_webhook_url is
  'Slack Incoming Webhook URL(通知連携用、admin のみ編集可)';
