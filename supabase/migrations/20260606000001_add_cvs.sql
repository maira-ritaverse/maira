-- ============================================
-- 職務経歴書(JIS様式、構造化データ)
--
-- 既存の resumes(履歴書)とは別テーブル。
-- 履歴書が「個人情報 + 学歴・職歴行 + 自由記述欄」なのに対し、
-- 職務経歴書は「職務要約 / 職務経歴(逆編年式) / スキル / 自己PR」を
-- 構造化して持つ。資格(licenses)は重複入力を避けるため、本テーブルでは
-- 持たず、license_resume_id で参照する履歴書から流用する。
--
-- 暗号化:本テーブルでは最初から本物の AES-256-GCM。
--   - encrypted_body は履歴書の encrypted_pii と同じ "v{n}:base64url" 形式
--   - lib/crypto/field-encryption.ts が読み書き境界
--   - bytea 暫定方式(career_profiles 等)は使わない
-- ============================================

create table if not exists public.cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 管理用:ユーザーが識別するためのラベル(例:「○○社向け」「汎用版」)
  title text not null default '職務経歴書',

  -- 様式右上に表示する「○年○月○日 現在」。null ならプレビュー/PDF 表示時に
  -- 本日の日付にフォールバック(履歴書と同じ運用)。
  document_date date,

  -- 資格は履歴書から参照する。
  --   - on delete set null:履歴書を消しても CV 本体は残す(別資産だから)
  --   - null = 履歴書未選択(資格欄なしで出す)
  license_resume_id uuid references public.resumes(id) on delete set null,

  -- 本文:{ summary, work_experiences[], skills[], self_pr } を JSON 化して
  -- AES-256-GCM で暗号化した文字列。"v{n}:base64url" 形式。
  -- アプリ層(lib/cvs/queries.ts)で読み書き時に encryptField/decryptField を通す。
  -- NOT NULL:空 CV でも cvBodySchema を JSON 化して暗号化するため、空にはならない。
  encrypted_body text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cvs is '職務経歴書(JIS様式、構造化データ、本人所有)';
comment on column public.cvs.title is 'ユーザーが識別するためのタイトル';
comment on column public.cvs.license_resume_id is
  '資格欄を引いてくる履歴書の参照。on delete set null で履歴書削除時も CV を残す。';
comment on column public.cvs.encrypted_body is
  '本文 JSON({summary, work_experiences[], skills[], self_pr})を AES-256-GCM で暗号化した文字列("v{n}:base64url" 形式)。lib/cvs/queries.ts が読み書き境界。';

create index if not exists idx_cvs_user_id on public.cvs(user_id);
create index if not exists idx_cvs_user_updated on public.cvs(user_id, updated_at desc);

-- ============================================
-- RLS:本人のみ全操作可能(履歴書と同型)
-- ============================================
alter table public.cvs enable row level security;

create policy "Users can view their own cvs"
  on public.cvs for select
  using (user_id = auth.uid());

create policy "Users can insert their own cvs"
  on public.cvs for insert
  with check (user_id = auth.uid());

create policy "Users can update their own cvs"
  on public.cvs for update
  using (user_id = auth.uid());

create policy "Users can delete their own cvs"
  on public.cvs for delete
  using (user_id = auth.uid());

-- ============================================
-- updated_at トリガー
-- (set_updated_at 関数は 20260530000001 で作成済み)
-- ============================================
drop trigger if exists set_cvs_updated_at on public.cvs;
create trigger set_cvs_updated_at
  before update on public.cvs
  for each row execute function public.set_updated_at();
