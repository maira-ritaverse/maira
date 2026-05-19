-- ============================================
-- Enum型の定義
-- 後続のテーブル定義から参照されるため、最初に作成する
-- ============================================

-- プラン種別
create type plan_type as enum ('free', 'standard', 'pro');

-- サブスクリプションのステータス
create type subscription_status as enum (
  'active',
  'past_due',
  'canceled',
  'trialing',
  'incomplete'
);

-- AIモジュール種別
create type module_type as enum (
  'career_inventory',     -- キャリア棚卸し
  'document_writer',      -- 書類作成
  'application_tracker',  -- 応募・進捗管理
  'interview_simulator'   -- 音声面接(本格ローンチで実装)
);

-- メッセージのロール
create type message_role as enum ('user', 'assistant', 'system');

-- 応募ステータス
create type application_status as enum (
  'considering',     -- 検討中
  'applied',         -- 応募済
  'document_review', -- 書類選考中
  'interview',       -- 面接中
  'offer',           -- 内定
  'rejected',        -- 不採用
  'declined',        -- 辞退
  'withdrawn'        -- 取り下げ
);

-- タスクステータス
create type task_status as enum ('pending', 'done', 'skipped', 'overdue');

-- 通知チャネル
create type notification_channel as enum ('email', 'push', 'in_app');

-- 通知種別
create type notification_kind as enum (
  'task_reminder',
  'application_followup',
  'milestone_check',
  'subscription_event',
  'system'
);

-- 利用ログの種別
create type usage_kind as enum (
  'message_sent',
  'interview_session',
  'document_generated',
  'voice_minutes'
);

-- 監査ログのアクション
create type audit_action as enum (
  'login',
  'logout',
  'password_changed',
  'recovery_key_regenerated',
  'data_exported',
  'account_deleted',
  'subscription_changed'
);
