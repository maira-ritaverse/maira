-- ============================================
-- 10テーブルの定義
-- 外部キー制約があるため、参照される順序で作成する
-- ============================================

-- ============================================
-- 1. profiles(プロフィール、Supabase Authのusersを拡張)
-- ============================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,

  -- 暗号化関連(運営者は中身を見れない)
  encrypted_master_key bytea not null,
  encrypted_master_key_by_recovery bytea not null,
  password_salt bytea not null,
  recovery_key_hint text,
  recovery_key_created_at timestamptz not null default now(),

  -- 公開メタデータ(暗号化不要)
  onboarding_completed boolean not null default false,
  preferred_industry text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'ユーザープロフィール(Supabase Authのusersを拡張)';
comment on column public.profiles.encrypted_master_key is 'パスワードで暗号化されたマスターキー';
comment on column public.profiles.encrypted_master_key_by_recovery is 'リカバリーキーで暗号化されたマスターキー';

-- ============================================
-- 2. subscriptions(サブスクリプション、Stripe連携)
-- ============================================
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  plan plan_type not null default 'free',
  status subscription_status not null default 'active',

  -- Stripe側のID
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,

  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 1ユーザー1サブスク
  unique(user_id)
);

create index idx_subscriptions_stripe_customer
  on public.subscriptions(stripe_customer_id);
create index idx_subscriptions_stripe_sub
  on public.subscriptions(stripe_subscription_id);

comment on table public.subscriptions is 'サブスクリプション情報(Stripeと連携)';

-- ============================================
-- 3. conversations(AI会話セッション)
-- ============================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module module_type not null,

  -- タイトルも暗号化
  encrypted_title bytea,

  -- 検索・並び替え用のメタデータ
  message_count int not null default 0,
  last_message_at timestamptz not null default now(),
  is_archived boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_conversations_user_module
  on public.conversations(user_id, module, last_message_at desc);

comment on table public.conversations is 'AI会話セッション(モジュール別)';

-- ============================================
-- 4. messages(会話の各メッセージ)
-- ============================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,

  role message_role not null,
  encrypted_content bytea not null,
  encryption_iv bytea not null,

  -- AI推論のメタデータ(課金・分析用)
  model_used text,
  input_tokens int,
  output_tokens int,

  created_at timestamptz not null default now()
);

create index idx_messages_conversation
  on public.messages(conversation_id, created_at);
create index idx_messages_user_created
  on public.messages(user_id, created_at desc);

comment on table public.messages is '会話の各メッセージ(暗号化済み)';

-- ============================================
-- 5. career_profiles(キャリア棚卸し結果)
-- ============================================
create table public.career_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade unique,

  encrypted_data bytea not null,
  encryption_iv bytea not null,

  version int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.career_profiles is 'キャリア棚卸しの構造化結果';

-- ============================================
-- 6. applications(応募管理)
-- ============================================
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- 企業名・職種など暗号化
  encrypted_details bytea not null,
  encryption_iv bytea not null,

  -- ステータスや日付はメタデータとして平文
  status application_status not null default 'considering',
  applied_at timestamptz,
  next_action_at timestamptz,

  is_archived boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_applications_user_status
  on public.applications(user_id, status, next_action_at);
create index idx_applications_next_action
  on public.applications(next_action_at)
  where next_action_at is not null;

comment on table public.applications is '応募管理(企業情報は暗号化、ステータスは平文)';

-- ============================================
-- 7. tasks(プロアクティブ伴走のためのタスク)
-- ============================================
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,

  encrypted_title bytea not null,
  encrypted_description bytea,
  encryption_iv bytea not null,

  -- 通知トリガー用のメタデータ
  due_at timestamptz,
  status task_status not null default 'pending',
  priority int not null default 0,

  reminded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tasks_user_due
  on public.tasks(user_id, status, due_at);
create index idx_tasks_pending_due
  on public.tasks(due_at)
  where status = 'pending';

comment on table public.tasks is 'プロアクティブ伴走のためのタスク';

-- ============================================
-- 8. notifications(通知ログ)
-- ============================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  kind notification_kind not null,
  channel notification_channel not null,

  encrypted_payload bytea,
  encryption_iv bytea,

  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  error_message text,

  created_at timestamptz not null default now()
);

create index idx_notifications_user_unread
  on public.notifications(user_id, read_at, created_at desc);
create index idx_notifications_pending
  on public.notifications(scheduled_at)
  where sent_at is null;

comment on table public.notifications is '通知ログ(送信履歴・既読管理)';

-- ============================================
-- 9. usage_logs(利用回数カウント)
-- ============================================
create table public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  kind usage_kind not null,
  module module_type,
  amount int not null default 1,

  billing_period_start timestamptz not null,

  created_at timestamptz not null default now()
);

create index idx_usage_user_period
  on public.usage_logs(user_id, billing_period_start, kind);

comment on table public.usage_logs is '利用回数カウント(プラン制限管理用)';

-- ============================================
-- 10. audit_logs(セキュリティ監査)
-- ============================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  action audit_action not null,
  ip_address inet,
  user_agent text,
  metadata jsonb,

  created_at timestamptz not null default now()
);

create index idx_audit_user_created
  on public.audit_logs(user_id, created_at desc);

comment on table public.audit_logs is 'セキュリティ監査ログ(機密操作の記録)';
