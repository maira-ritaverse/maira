-- ============================================
-- クライアント(求職者)名簿の EMPRO 準拠 完全拡張
--
-- 既存の client_records は MVP 〜 EMPRO Phase A の最小拡張までで
-- 9 平文 + 3 暗号化(計 12)列。EMPRO の 35 列構成に近づけるため、
-- 名簿として価値の高い 23 列を追加する。全て NULL 許容で既存行は不変。
--
-- ───────────────────────────────────────────────
-- 暗号化方針(既存パターンを踏襲):
--   - 集計 / 絞り込み / マッチングに使う数値 / enum / タグ / 日付 → 平文
--   - 自由記述メモ系(個人特定リスク + 内部メモ) → AES-256-GCM
--
-- 名簿の検索性(カナ・年齢層・エリア・希望業種)を確保するため、検索キーに
-- 当たる属性は平文で持つ。Maira 既存の name/email/phone も平文の前例あり。
--
-- ───────────────────────────────────────────────
-- カテゴリ別 列リスト:
--
-- [基本属性 / 個人]
--   name_kana                 text         氏名カナ(検索のため平文)
--   birth_date                date         生年月日(年齢計算 / 年代分布のため平文)
--   gender                    text(enum)   性別(任意)
--   nationality               text         国籍(任意、自由記述で多様な書き方を許容)
--   marital_status            text(enum)   配偶者(任意)
--
-- [住所]
--   postal_code               text         郵便番号(7 桁、ハイフン任意)
--   prefecture                text         都道府県(エリア絞込のため平文)
--   city                      text         市区町村
--   street                    text         番地
--   building                  text         建物名・部屋番号
--
-- [連絡先 副]
--   phone2                    text         副電話
--   email2                    text         副メール
--
-- [現職情報]
--   current_employment_type   text(enum)   現在の雇用形態
--   current_annual_income     integer      現在年収(万円)
--   final_education           text(enum)   最終学歴
--   encrypted_education_detail text        学歴(詳細)。自由記述、暗号化
--   experience_industries     text[]       経験業種(タグ、絞込のため平文配列)
--   experience_occupations    text[]       経験職種(タグ)
--   encrypted_skills          text         保有資格・スキル。自由記述、暗号化
--
-- [希望条件]
--   desired_industries        text[]       希望業種(タグ)
--   desired_occupations       text[]       希望職種(タグ)
--   desired_locations         text[]       希望勤務地(タグ。「東京都」「大阪府」等)
--   desired_annual_income     integer      希望年収(万円)
--   job_change_timing         text(enum)   転職希望時期
--   encrypted_job_change_reason text       転職理由(自由記述、暗号化)
--   encrypted_desired_conditions text      希望条件詳細(自由記述、暗号化)
--
-- [運用 / 面談]
--   intake_date               date         受付年月日(一次接触日)
--   first_meeting_date        date         面談実施日
--   encrypted_meeting_notes   text         面談所感(内部メモ、暗号化)
--   encrypted_status_memo     text         ステータスメモ(内部メモ、暗号化)
--
-- ============================================

alter table public.client_records
  -- ----- 基本属性 -----
  add column if not exists name_kana text,
  add column if not exists birth_date date,
  add column if not exists gender text
    check (gender is null or gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  add column if not exists nationality text,
  add column if not exists marital_status text
    check (marital_status is null or marital_status in ('single', 'married', 'prefer_not_to_say')),
  -- ----- 住所 -----
  add column if not exists postal_code text,
  add column if not exists prefecture text,
  add column if not exists city text,
  add column if not exists street text,
  add column if not exists building text,
  -- ----- 連絡先 副 -----
  add column if not exists phone2 text,
  add column if not exists email2 text,
  -- ----- 現職情報 -----
  add column if not exists current_employment_type text
    check (current_employment_type is null or current_employment_type in (
      'full_time', 'contract', 'temporary', 'part_time',
      'business_outsource', 'self_employed', 'unemployed', 'student', 'other'
    )),
  add column if not exists current_annual_income integer
    check (current_annual_income is null or (current_annual_income >= 0 and current_annual_income <= 100000)),
  add column if not exists final_education text
    check (final_education is null or final_education in (
      'high_school', 'vocational', 'junior_college',
      'university', 'graduate', 'doctorate', 'other'
    )),
  add column if not exists encrypted_education_detail text,
  add column if not exists experience_industries text[],
  add column if not exists experience_occupations text[],
  add column if not exists encrypted_skills text,
  -- ----- 希望条件 -----
  add column if not exists desired_industries text[],
  add column if not exists desired_occupations text[],
  add column if not exists desired_locations text[],
  add column if not exists desired_annual_income integer
    check (desired_annual_income is null or (desired_annual_income >= 0 and desired_annual_income <= 100000)),
  add column if not exists job_change_timing text
    check (job_change_timing is null or job_change_timing in (
      'immediate', 'within_3months', 'within_6months', 'within_1year', 'undecided'
    )),
  add column if not exists encrypted_job_change_reason text,
  add column if not exists encrypted_desired_conditions text,
  -- ----- 運用 / 面談 -----
  add column if not exists intake_date date,
  add column if not exists first_meeting_date date,
  add column if not exists encrypted_meeting_notes text,
  add column if not exists encrypted_status_memo text;

-- ────────────────────────────────────────────
-- 検索系インデックス(カナ・受付日・面談日・転職時期で並び替える想定)
-- ────────────────────────────────────────────
create index if not exists idx_client_records_name_kana
  on public.client_records(organization_id, name_kana)
  where name_kana is not null;

create index if not exists idx_client_records_intake_date
  on public.client_records(organization_id, intake_date desc)
  where intake_date is not null;

create index if not exists idx_client_records_first_meeting_date
  on public.client_records(organization_id, first_meeting_date desc)
  where first_meeting_date is not null;

create index if not exists idx_client_records_job_change_timing
  on public.client_records(organization_id, job_change_timing)
  where job_change_timing is not null;

create index if not exists idx_client_records_prefecture
  on public.client_records(organization_id, prefecture)
  where prefecture is not null;

-- 経験 / 希望業種・職種・勤務地は配列なので GIN
create index if not exists idx_client_records_desired_industries
  on public.client_records using gin (desired_industries);
create index if not exists idx_client_records_desired_occupations
  on public.client_records using gin (desired_occupations);
create index if not exists idx_client_records_desired_locations
  on public.client_records using gin (desired_locations);

-- ────────────────────────────────────────────
-- カラムコメント(運用ドキュメント代わり)
-- ────────────────────────────────────────────
comment on column public.client_records.name_kana                 is '氏名カナ(検索・五十音ソート用、平文)。';
comment on column public.client_records.birth_date                is '生年月日(年齢計算・年代分布用、平文)。';
comment on column public.client_records.gender                    is '性別(任意)。male/female/other/prefer_not_to_say。';
comment on column public.client_records.nationality               is '国籍(任意、自由記述)。';
comment on column public.client_records.marital_status            is '配偶者(任意)。single/married/prefer_not_to_say。';
comment on column public.client_records.postal_code               is '郵便番号(7 桁、ハイフン任意)。';
comment on column public.client_records.prefecture                is '都道府県(エリア絞込のため平文)。';
comment on column public.client_records.city                      is '市区町村。';
comment on column public.client_records.street                    is '番地。';
comment on column public.client_records.building                  is '建物名・部屋番号。';
comment on column public.client_records.phone2                    is '副電話(任意)。';
comment on column public.client_records.email2                    is '副メール(任意)。';
comment on column public.client_records.current_employment_type   is '現在の雇用形態。full_time/contract/temporary/part_time/business_outsource/self_employed/unemployed/student/other。';
comment on column public.client_records.current_annual_income     is '現在年収(万円、0〜100000)。';
comment on column public.client_records.final_education           is '最終学歴。high_school/vocational/junior_college/university/graduate/doctorate/other。';
comment on column public.client_records.encrypted_education_detail is '学歴(詳細)。自由記述、AES-256-GCM 暗号化。';
comment on column public.client_records.experience_industries     is '経験業種(タグ配列、平文)。';
comment on column public.client_records.experience_occupations    is '経験職種(タグ配列、平文)。';
comment on column public.client_records.encrypted_skills          is '保有資格・スキル(自由記述、暗号化)。';
comment on column public.client_records.desired_industries        is '希望業種(タグ配列、平文。GIN インデックスで絞込可)。';
comment on column public.client_records.desired_occupations       is '希望職種(タグ配列、平文)。';
comment on column public.client_records.desired_locations         is '希望勤務地(タグ配列、平文。例:「東京都」「大阪府」)。';
comment on column public.client_records.desired_annual_income     is '希望年収(万円、0〜100000)。';
comment on column public.client_records.job_change_timing         is '転職希望時期。immediate/within_3months/within_6months/within_1year/undecided。';
comment on column public.client_records.encrypted_job_change_reason is '転職理由(自由記述、暗号化)。';
comment on column public.client_records.encrypted_desired_conditions is '希望条件詳細(自由記述、暗号化)。';
comment on column public.client_records.intake_date               is '受付年月日(一次接触日、集計の起点)。';
comment on column public.client_records.first_meeting_date        is '面談実施日(エージェント業務のキー日付)。';
comment on column public.client_records.encrypted_meeting_notes   is '面談所感(内部メモ、暗号化)。';
comment on column public.client_records.encrypted_status_memo     is 'ステータスメモ(現在の status の補足、内部メモ、暗号化)。';
