-- ============================================
-- Advisor チャット (求職者 ↔ エージェント DM)
--
-- 目的:
--   LINE 友達 紐付け が ない 求職者 と も、 Maira アプリ 内 で
--   双方向 メッセージ が やり取り できる よう に する。
--
-- スレッド:
--   1 client_records 行 に つき 1 thread (UNIQUE)。
--   求職者 側 から も エージェント 側 から も 同じ thread が 見える。
--
-- 暗号化:
--   メッセージ 本文 は AES-256-GCM 暗号化 (lib/crypto/field-encryption.ts、
--   "v{n}:base64url" 形式)。 既存 messages テーブル と 同じ パターン。
--
-- RLS:
--   求職者: 自分 の seeker_user_id の thread / messages のみ
--   エージェント: 自分 の organization_id の thread / messages のみ
--   INSERT は どちら 側 も user 経由 で 行う (service_role 強制 では ない)
-- ============================================

-- ============================================
-- 1. advisor_threads (求職者 1 名 に つき 1 thread)
-- ============================================
create table if not exists public.advisor_threads (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  -- client_records.id (1 求職者 1 thread)
  client_record_id uuid not null
    references public.client_records(id) on delete cascade,
  -- client_records.linked_user_id と 同じ。 未連携 (linked_user_id IS NULL) なら
  -- thread も 作れ ない (UI で ガード)。
  seeker_user_id uuid not null
    references auth.users(id) on delete cascade,

  last_message_at timestamptz,
  -- 既読 カウンタ (push 通知 / バッジ 表示 用)。 sender の 投稿 で
  -- 反対側 の カウンタ を ++、 反対側 が 開いた タイミング で 0 リセット。
  unread_for_seeker int not null default 0,
  unread_for_agency int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 1 client_records に つき 1 thread の 保証
  unique (organization_id, client_record_id)
);

comment on table public.advisor_threads is
  '求職者 ↔ エージェント の DM スレッド。 1 client_records に 1 thread。';

create index if not exists idx_advisor_threads_org_last
  on public.advisor_threads (organization_id, last_message_at desc nulls last);
create index if not exists idx_advisor_threads_seeker
  on public.advisor_threads (seeker_user_id, last_message_at desc nulls last);

-- updated_at trigger
drop trigger if exists set_advisor_threads_updated_at on public.advisor_threads;
create trigger set_advisor_threads_updated_at
  before update on public.advisor_threads
  for each row execute function public.set_updated_at();

-- ============================================
-- 2. advisor_messages
-- ============================================
create table if not exists public.advisor_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null
    references public.advisor_threads(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('seeker', 'agency')),
  sender_user_id uuid not null references auth.users(id) on delete set null,

  -- 本文 (AES-256-GCM 暗号化、 "v{n}:base64url" 形式 の text)
  encrypted_content text not null,

  -- 既読 タイムスタンプ (反対側 が 開いた 時 に セット)
  read_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.advisor_messages is
  'advisor thread の 個別 メッセージ。 本文 は AES-256-GCM 暗号化。';

create index if not exists idx_advisor_messages_thread_created
  on public.advisor_messages (thread_id, created_at desc);

-- ============================================
-- RLS
-- ============================================
alter table public.advisor_threads enable row level security;
alter table public.advisor_messages enable row level security;

-- ── advisor_threads ──
drop policy if exists at_select_seeker on public.advisor_threads;
create policy at_select_seeker on public.advisor_threads for select
  using (seeker_user_id = auth.uid());

drop policy if exists at_select_agency on public.advisor_threads;
create policy at_select_agency on public.advisor_threads for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: エージェント 側 (組織 メンバー) が 新規 thread を 作る
-- 求職者 側 は 自分 で thread を 作る 必要 が ない (エージェント が 先 に 作る)。
-- ただし 求職者 側 から 「相談 を 始める」を 押した 場合 を 想定 し、
-- seeker_user_id = auth.uid() でも 作成 を 許可 する。
drop policy if exists at_insert_agency on public.advisor_threads;
create policy at_insert_agency on public.advisor_threads for insert
  with check (
    organization_id = public.current_user_organization_id()
    or seeker_user_id = auth.uid()
  );

-- UPDATE: 既読 カウンタ リセット や last_message_at 更新 を どちら 側 でも 許可
drop policy if exists at_update_either on public.advisor_threads;
create policy at_update_either on public.advisor_threads for update
  using (
    seeker_user_id = auth.uid()
    or organization_id = public.current_user_organization_id()
  )
  with check (
    seeker_user_id = auth.uid()
    or organization_id = public.current_user_organization_id()
  );

-- ── advisor_messages ──
drop policy if exists am_select_seeker on public.advisor_messages;
create policy am_select_seeker on public.advisor_messages for select
  using (
    exists (
      select 1 from public.advisor_threads t
      where t.id = thread_id and t.seeker_user_id = auth.uid()
    )
  );

drop policy if exists am_select_agency on public.advisor_messages;
create policy am_select_agency on public.advisor_messages for select
  using (
    exists (
      select 1 from public.advisor_threads t
      where t.id = thread_id and t.organization_id = public.current_user_organization_id()
    )
  );

-- INSERT: thread に 紐づく 当事者 のみ。 sender_kind と sender_user_id の
-- 整合性 は API 側 で 担保 する (RLS では thread 所属 だけ 検証)。
drop policy if exists am_insert_seeker on public.advisor_messages;
create policy am_insert_seeker on public.advisor_messages for insert
  with check (
    sender_user_id = auth.uid()
    and sender_kind = 'seeker'
    and exists (
      select 1 from public.advisor_threads t
      where t.id = thread_id and t.seeker_user_id = auth.uid()
    )
  );

drop policy if exists am_insert_agency on public.advisor_messages;
create policy am_insert_agency on public.advisor_messages for insert
  with check (
    sender_user_id = auth.uid()
    and sender_kind = 'agency'
    and exists (
      select 1 from public.advisor_threads t
      where t.id = thread_id and t.organization_id = public.current_user_organization_id()
    )
  );

-- UPDATE: 自分 が 送信した 行 の read_at だけ 反対側 が 触れる。
-- 簡略化: thread 当事者 なら read_at を 触って OK (Phase 2 で 細分化)。
drop policy if exists am_update_either on public.advisor_messages;
create policy am_update_either on public.advisor_messages for update
  using (
    exists (
      select 1 from public.advisor_threads t
      where t.id = thread_id
        and (t.seeker_user_id = auth.uid()
          or t.organization_id = public.current_user_organization_id())
    )
  )
  with check (
    exists (
      select 1 from public.advisor_threads t
      where t.id = thread_id
        and (t.seeker_user_id = auth.uid()
          or t.organization_id = public.current_user_organization_id())
    )
  );

-- ============================================
-- notification_kind enum に advisor_message を 追加
--
-- Postgres は ALTER TYPE ... ADD VALUE が トランザクション 内 で 使え ない 場合 が
-- あるため、 値 が 既に 存在 する 場合 を スキップ する 形 で 安全 に 追加。
-- ============================================
alter type public.notification_kind add value if not exists 'advisor_message';
