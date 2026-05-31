-- ============================================
-- 履歴書(構造化データ、厚労省推奨様式 2021〜 準拠)
--
-- 既存の documents 機能(messages に AI 生成テキストを保存)とは別物。
-- 履歴書を「しっかりした様式の PDF」にするには、テキストではなく
-- 項目ごとの構造化データで持つ必要があるため、別テーブルとして設計した。
--
-- 厚労省様式(2021〜)に合わせて以下の方針:
--   - 性別は任意('male' / 'female' / 'unspecified' / null)
--   - 通勤時間・扶養家族数・配偶者欄は持たない(厚労省様式で削除済み)
--
-- 暗号化:今は未実装(開発中、本番データなし)。将来まとめて対応する。
-- 個人情報カラムはまとまっているので、後から encrypted_* に置き換えやすい。
-- ============================================

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 管理用(ユーザーが履歴書を識別するためのラベル)
  title text not null default '履歴書',

  -- 基本情報
  name text,
  name_kana text,
  birth_date date,
  gender text check (gender in ('male', 'female', 'unspecified') or gender is null),
  postal_code text,
  address text,
  address_kana text,
  phone text,
  email text,
  contact_address text,

  -- 写真(今回は任意・後回し。カラムだけ用意しておく)
  photo_url text,

  -- 学歴・職歴(JSON配列)
  -- 厚労省様式は学歴と職歴を同じ欄に時系列で書く。
  -- 例: [{ "year": 2015, "month": 4, "description": "○○大学 入学" }, ...]
  education_history jsonb not null default '[]'::jsonb,

  -- 免許・資格(JSON配列)
  -- 例: [{ "year": 2018, "month": 6, "name": "普通自動車第一種運転免許" }, ...]
  licenses jsonb not null default '[]'::jsonb,

  -- 本人希望記入欄
  personal_requests text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.resumes is '履歴書(構造化データ、厚労省推奨様式 2021〜 準拠、本人所有)';
comment on column public.resumes.title is 'ユーザーが識別するためのタイトル(例:○○社向け、汎用版)';
comment on column public.resumes.gender is '任意。厚労省様式準拠。null = 未入力';
comment on column public.resumes.education_history is
  '学歴・職歴。[{year, month, description}] の配列。学歴/職歴の見出し行も description として入れられる';
comment on column public.resumes.licenses is '免許・資格。[{year, month, name}] の配列';

create index if not exists idx_resumes_user_id on public.resumes(user_id);

alter table public.resumes enable row level security;

-- ============================================
-- RLS:本人のみ全操作可能
--
-- 履歴書は完全に「本人所有」のデータ。エージェントや他人と共有する
-- 仕組みは今回作らない(将来必要なら別ポリシーを追加する)。
-- ============================================
create policy "Users can view their own resumes"
  on public.resumes for select
  using (user_id = auth.uid());

create policy "Users can insert their own resumes"
  on public.resumes for insert
  with check (user_id = auth.uid());

create policy "Users can update their own resumes"
  on public.resumes for update
  using (user_id = auth.uid());

create policy "Users can delete their own resumes"
  on public.resumes for delete
  using (user_id = auth.uid());

-- ============================================
-- updated_at トリガー
-- (set_updated_at 関数は 20260530000001 で作成済み)
-- ============================================
drop trigger if exists set_resumes_updated_at on public.resumes;
create trigger set_resumes_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();
