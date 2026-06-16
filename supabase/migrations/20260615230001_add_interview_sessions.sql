-- =====================================================================
-- 面接シミュレーターセッション(interview_sessions / interview_messages)
--
-- 設計:
--   - 1 ユーザー × N セッション、各セッションは複数メッセージで構成
--   - メッセージは AES-256-GCM 暗号化(field-encryption と同じ方式)
--   - position_context は平文 jsonb(企業名 / ポジション、PII ではないので)
--   - セッション完了時に AI 生成の総評を summary に格納(暗号化)
--   - 履歴の閲覧 / 削除は本人のみ(RLS)
-- =====================================================================

create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 任意のコンテキスト(企業名 / ポジション)
  position_context jsonb not null default '{}'::jsonb,
  -- セッション開始 / 完了
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  -- 完了時に AI 総評を暗号化保存(セッションを再開しないなら null のまま)
  encrypted_summary text,
  created_at timestamptz not null default now()
);

create index if not exists is_user_idx
  on public.interview_sessions (user_id, started_at desc);

create table if not exists public.interview_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  encrypted_content text not null,
  created_at timestamptz not null default now()
);

create index if not exists im_session_created_idx
  on public.interview_messages (session_id, created_at);

comment on table public.interview_sessions is '面接シミュレーターのセッション(ユーザー単位、本人のみ閲覧可)';
comment on table public.interview_messages is '面接メッセージ(AES-256-GCM 暗号化、本人のみ閲覧可)';

-- ===========================
-- RLS
-- ===========================
alter table public.interview_sessions enable row level security;
alter table public.interview_messages enable row level security;

drop policy if exists "Users can manage own interview sessions" on public.interview_sessions;
create policy "Users can manage own interview sessions"
  on public.interview_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- メッセージは「親セッションが自分のもの」を join 経由で確認
drop policy if exists "Users can view own interview messages" on public.interview_messages;
create policy "Users can view own interview messages"
  on public.interview_messages for select
  using (
    exists (
      select 1 from public.interview_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert own interview messages" on public.interview_messages;
create policy "Users can insert own interview messages"
  on public.interview_messages for insert
  with check (
    exists (
      select 1 from public.interview_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete own interview messages" on public.interview_messages;
create policy "Users can delete own interview messages"
  on public.interview_messages for delete
  using (
    exists (
      select 1 from public.interview_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );
