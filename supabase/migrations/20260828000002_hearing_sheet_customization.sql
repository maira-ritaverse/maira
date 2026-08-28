-- =====================================================================
-- ヒアリングシートの組織別カスタマイズ
--
-- 目的:
--   ・エージェント(組織)ごとにヒアリングシートの「質問項目の増減・リネーム」
--     と「シートのタイトル」を設定できるようにする。
--   ・質問に maps_to_pii を持たせ、回答からエージェントのクライアント履歴書
--     (agency_client_resumes の本人情報 = ResumePii)を埋められるようにする。
--
-- 設計:
--   ・client_custom_field_definitions と同型の定義テーブルを新設
--     (per-org・SELECT=メンバー / 追加更新削除=admin のみ)。
--   ・ヒアリングシートの回答本体(hearing_sheets.encrypted_content)は
--     暗号化 JSON 1 カラムのまま。キーが定義の key に対応する形へ移行するが、
--     列マイグレーションは不要(JSON の形だけ変わる)。
--   ・「完全カスタム」だが、会議録音→ヒアリングシート自動抽出(extraction)や
--     AI 履歴書生成が壊れないよう、標準 11 項目を "種" として seed する。
--     標準キーは extraction の出力キーと一致させ、org はその上で増減できる。
--   ・既存 org には 11 項目を backfill、新規 org には作成時トリガーで seed。
--     アプリ側でも「定義が 0 件なら標準 11 をフォールバック」して二重に守る。
--
-- maps_to_pii の値は agency 側 ResumePii のキーに一致させる
--   (full_name / full_name_kana / birth_date / gender / postal_code /
--    address / address_kana / phone / email / motivation / self_pr / preferences)。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 質問定義テーブル
-- ---------------------------------------------------------------------
create table if not exists public.hearing_sheet_question_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- hearing_sheets.encrypted_content(JSON)のキーになる。英小文字始まりの英数 + _。
  key text not null check (key ~ '^[a-z][a-z0-9_]*$' and length(key) <= 50),
  label text not null check (length(trim(label)) > 0 and length(label) <= 100),
  -- 補助説明(任意)。UI でラベル下に薄字で出す用途。
  help_text text check (help_text is null or length(help_text) <= 500),
  -- 入力欄の種類。free-text 前提なので text(1 行)/ textarea(複数行)の 2 種のみ。
  input_type text not null default 'textarea' check (input_type in ('text', 'textarea')),
  max_length integer not null default 2000 check (max_length between 1 and 8000),
  -- 設定されていれば、その回答を ResumePii の該当キーへ流し込める(②B)。
  maps_to_pii text check (
    maps_to_pii is null
    or maps_to_pii in (
      'full_name', 'full_name_kana', 'birth_date', 'gender',
      'postal_code', 'address', 'address_kana', 'phone', 'email',
      'motivation', 'self_pr', 'preferences'
    )
  ),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists hsqd_org_order_idx
  on public.hearing_sheet_question_definitions (organization_id, display_order, created_at);

comment on table public.hearing_sheet_question_definitions is
  'ヒアリングシートの質問定義(組織別、hearing_sheets.encrypted_content のキー / ラベル / 本人情報マッピングを決める)';

drop trigger if exists set_hsqd_updated_at on public.hearing_sheet_question_definitions;
create trigger set_hsqd_updated_at
  before update on public.hearing_sheet_question_definitions
  for each row execute function public.set_updated_at();

alter table public.hearing_sheet_question_definitions enable row level security;

-- SELECT はメンバー全員(回答画面で質問を出すため)
drop policy if exists "Org members can view hsqd" on public.hearing_sheet_question_definitions;
create policy "Org members can view hsqd"
  on public.hearing_sheet_question_definitions for select
  using (organization_id = public.current_user_organization_id());

-- 追加 / 更新 / 削除(= テンプレートの編集)は admin のみ
drop policy if exists "Admins can insert hsqd" on public.hearing_sheet_question_definitions;
create policy "Admins can insert hsqd"
  on public.hearing_sheet_question_definitions for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can update hsqd" on public.hearing_sheet_question_definitions;
create policy "Admins can update hsqd"
  on public.hearing_sheet_question_definitions for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can delete hsqd" on public.hearing_sheet_question_definitions;
create policy "Admins can delete hsqd"
  on public.hearing_sheet_question_definitions for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ---------------------------------------------------------------------
-- 2. 新規 org 作成時に標準 11 項目を seed するトリガー
--
-- key は career_intake の抽出結果(extraction-to-hearing)の出力キーと一致させる。
-- これにより「会議録音→ヒアリングシート自動抽出」は org が該当キーを残している
-- 限り従来どおり動く。maps_to_pii は標準項目には付けない(いずれもキャリア内容で
-- 本人情報ではないため)。
-- ---------------------------------------------------------------------
create or replace function public.seed_default_hearing_sheet_questions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hearing_sheet_question_definitions
    (organization_id, key, label, input_type, max_length, display_order)
  values
    (new.id, 'current_job',       '現職',            'textarea', 2000, 10),
    (new.id, 'job_change_reason', '転職理由',        'textarea', 2000, 20),
    (new.id, 'strengths',         '強み',            'textarea', 2000, 30),
    (new.id, 'weaknesses',        '弱み・課題',      'textarea', 2000, 40),
    (new.id, 'desired_industry',  '希望業種',        'textarea',  500, 50),
    (new.id, 'desired_position',  '希望職種',        'textarea',  500, 60),
    (new.id, 'desired_location',  '希望勤務地',      'textarea',  500, 70),
    (new.id, 'desired_salary',    '希望年収',        'textarea',  200, 80),
    (new.id, 'motivation',        '動機・志望',      'textarea', 2000, 90),
    (new.id, 'availability',      '入社可能時期',    'textarea',  500, 100),
    (new.id, 'notes',             'メモ(自由記述)', 'textarea', 4000, 110)
  on conflict (organization_id, key) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_hearing_questions on public.organizations;
create trigger trg_seed_hearing_questions
  after insert on public.organizations
  for each row execute function public.seed_default_hearing_sheet_questions();

-- ---------------------------------------------------------------------
-- 3. 既存 org への backfill(同じ標準 11 項目)
-- ---------------------------------------------------------------------
insert into public.hearing_sheet_question_definitions
  (organization_id, key, label, input_type, max_length, display_order)
select o.id, d.key, d.label, d.input_type, d.max_length, d.display_order
from public.organizations o
cross join (
  values
    ('current_job',       '現職',            'textarea', 2000, 10),
    ('job_change_reason', '転職理由',        'textarea', 2000, 20),
    ('strengths',         '強み',            'textarea', 2000, 30),
    ('weaknesses',        '弱み・課題',      'textarea', 2000, 40),
    ('desired_industry',  '希望業種',        'textarea',  500, 50),
    ('desired_position',  '希望職種',        'textarea',  500, 60),
    ('desired_location',  '希望勤務地',      'textarea',  500, 70),
    ('desired_salary',    '希望年収',        'textarea',  200, 80),
    ('motivation',        '動機・志望',      'textarea', 2000, 90),
    ('availability',      '入社可能時期',    'textarea',  500, 100),
    ('notes',             'メモ(自由記述)', 'textarea', 4000, 110)
) as d(key, label, input_type, max_length, display_order)
on conflict (organization_id, key) do nothing;

-- ---------------------------------------------------------------------
-- 4. ヒアリングシートのタイトル(組織別・1 行 / org)
--
-- organization_ai_recommendation_settings と同じ「organization_id PK の
-- 1 行 / org 設定テーブル」パターン。行が無い org は既定 'ヒアリングシート' を
-- アプリ側で用いる(backfill 不要・初回保存時に upsert で作成)。
-- ---------------------------------------------------------------------
create table if not exists public.organization_hearing_sheet_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  title text not null default 'ヒアリングシート'
    check (length(trim(title)) > 0 and length(title) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organization_hearing_sheet_settings is
  'ヒアリングシートの組織別設定(現状はシートのタイトルのみ)';

drop trigger if exists set_ohss_updated_at on public.organization_hearing_sheet_settings;
create trigger set_ohss_updated_at
  before update on public.organization_hearing_sheet_settings
  for each row execute function public.set_updated_at();

alter table public.organization_hearing_sheet_settings enable row level security;

drop policy if exists "Org members can view ohss" on public.organization_hearing_sheet_settings;
create policy "Org members can view ohss"
  on public.organization_hearing_sheet_settings for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Admins can insert ohss" on public.organization_hearing_sheet_settings;
create policy "Admins can insert ohss"
  on public.organization_hearing_sheet_settings for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can update ohss" on public.organization_hearing_sheet_settings;
create policy "Admins can update ohss"
  on public.organization_hearing_sheet_settings for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
