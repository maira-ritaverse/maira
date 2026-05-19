-- ============================================
-- Row Level Security(行レベルセキュリティ)の設定
-- すべてのテーブルで「自分のレコードのみアクセス可能」を強制する
-- ============================================

-- ============================================
-- すべてのテーブルでRLSを有効化
-- ============================================
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.career_profiles enable row level security;
alter table public.applications enable row level security;
alter table public.tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.usage_logs enable row level security;
alter table public.audit_logs enable row level security;

-- ============================================
-- 1. profiles
-- ユーザーは自分のプロフィールのみ閲覧・更新可能
-- ============================================
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================
-- 2. subscriptions
-- ユーザーは自分のサブスクリプションを閲覧のみ可能
-- INSERT/UPDATEはservice_role限定(Stripe Webhook経由)
-- ============================================
create policy "Users can view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- INSERT/UPDATEポリシーは作らない(service_roleのみ書き込み可能)

-- ============================================
-- 3. conversations
-- ユーザーは自分の会話のみ操作可能
-- ============================================
create policy "Users can view own conversations"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert own conversations"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own conversations"
  on public.conversations for update
  using (auth.uid() = user_id);

create policy "Users can delete own conversations"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- ============================================
-- 4. messages
-- ユーザーは自分のメッセージのみ操作可能
-- ============================================
create policy "Users can view own messages"
  on public.messages for select
  using (auth.uid() = user_id);

create policy "Users can insert own messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own messages"
  on public.messages for delete
  using (auth.uid() = user_id);

-- ============================================
-- 5. career_profiles
-- ユーザーは自分のキャリア棚卸しのみ操作可能
-- ============================================
create policy "Users can view own career profile"
  on public.career_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own career profile"
  on public.career_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own career profile"
  on public.career_profiles for update
  using (auth.uid() = user_id);

-- ============================================
-- 6. applications
-- ユーザーは自分の応募のみ操作可能
-- ============================================
create policy "Users can view own applications"
  on public.applications for select
  using (auth.uid() = user_id);

create policy "Users can insert own applications"
  on public.applications for insert
  with check (auth.uid() = user_id);

create policy "Users can update own applications"
  on public.applications for update
  using (auth.uid() = user_id);

create policy "Users can delete own applications"
  on public.applications for delete
  using (auth.uid() = user_id);

-- ============================================
-- 7. tasks
-- ユーザーは自分のタスクのみ操作可能
-- ============================================
create policy "Users can view own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "Users can insert own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tasks"
  on public.tasks for update
  using (auth.uid() = user_id);

create policy "Users can delete own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

-- ============================================
-- 8. notifications
-- ユーザーは自分の通知のみ閲覧・更新可能
-- INSERTはservice_role限定(Edge Functionsから発行)
-- ============================================
create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- INSERTポリシーは作らない(service_roleのみ書き込み可能)

-- ============================================
-- 9. usage_logs
-- ユーザーは自分の利用ログを閲覧可能
-- INSERTはservice_role限定
-- ============================================
create policy "Users can view own usage logs"
  on public.usage_logs for select
  using (auth.uid() = user_id);

-- INSERTポリシーは作らない(API側で記録)

-- ============================================
-- 10. audit_logs
-- ユーザーは自分の監査ログを閲覧可能
-- INSERTはservice_role限定
-- ============================================
create policy "Users can view own audit logs"
  on public.audit_logs for select
  using (auth.uid() = user_id);

-- INSERTポリシーは作らない(API側で記録)
