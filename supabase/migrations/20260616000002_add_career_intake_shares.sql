-- =====================================================================
-- AI ヒアリング結果のエージェント共有リンク(career_intake_shares)
--
-- 求職者が抽出結果を URL 1 本で「エージェントに見せる」ためのトークン管理。
-- 公開ページ /share/intake/[token] で認証不要で閲覧できる(URL = capability)。
--
-- 設計:
--   ・1 録音 × 複数共有リンクを許可(別エージェントごとに作るユースケース)
--   ・expires_at は必須。デフォルト 7 日先(API で設定)
--   ・revoked_at が立っている時は読み出し拒否
--   ・本人のみが作成 / 失効可
-- =====================================================================

create table if not exists public.career_intake_shares (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.career_intake_recordings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- URL のトークン(uuid v4、推測不能な乱数)
  token uuid not null unique default gen_random_uuid(),
  -- 任意のラベル(「○○社向け」など)
  label text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cis_user_created_idx
  on public.career_intake_shares (user_id, created_at desc);

create index if not exists cis_recording_idx
  on public.career_intake_shares (recording_id);

comment on table public.career_intake_shares is
  'AI ヒアリング結果のエージェント共有リンク(URL ベースの一時公開)';
comment on column public.career_intake_shares.token is
  '公開 URL のトークン(/share/intake/[token])';

-- ===========================
-- RLS
-- ===========================
alter table public.career_intake_shares enable row level security;

-- 本人のみ管理可
drop policy if exists "Users can manage own intake shares" on public.career_intake_shares;
create policy "Users can manage own intake shares"
  on public.career_intake_shares for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 公開 URL での閲覧は API ルートが service_role 経由で行う(RLS バイパス)
