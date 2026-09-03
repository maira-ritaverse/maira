-- =====================================================================
-- 運営(株式会社Revorise)向け 営業パイプライン / 商談管理
--
-- 目的:
--   Myaira を売る側(運営 = maira admin)が、営業先の会社ごとに「商談」を管理し、
--   各ミーティングの録音をアップロード → AI 文字起こし → 議事録化 → AI が次アクションを
--   提案する、内部向けの営業支援ツール。エージェント / 求職者向け機能とは無関係。
--
-- アクセス制御:
--   すべて is_maira_admin(profiles.is_maira_admin = true)限定。
--   SELECT / UPDATE / DELETE は is_maira_admin ポリシー、INSERT はポリシー無し
--   (= service_role のみ)。API ルート(app/api/admin/deals/*)が isMairaAdmin() で
--   ゲートしてから createServiceClient() で書き込む(既存 contact_messages と同型)。
--
-- 機密テキスト(トランスクリプト / 議事録 / AIアドバイス)は AES-256-GCM で暗号化して
--   保存する(lib/crypto/field-encryption.ts、v{n}:base64url 形式)。会社名・連絡先は
--   検索性のため平文(求職者の個人情報ではなく、運営自身の営業先情報)。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 商談(営業先の会社)
-- ---------------------------------------------------------------------
create table if not exists public.sales_prospects (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (length(trim(company_name)) > 0 and length(company_name) <= 200),
  contact_name text check (contact_name is null or length(contact_name) <= 100),
  contact_email text check (contact_email is null or length(contact_email) <= 254),
  -- 営業ステージ(プレイブックに対応。lib/sales/types.ts の SALES_STAGES と一致させる)
  stage text not null default 'lead' check (
    stage in (
      'lead',            -- リード(問い合わせ・見込み)
      'sales_1',         -- 営業1回目
      'sales_2',         -- 営業2回目
      'test_decided',    -- テスト導入決定
      'account_signed',  -- アカウント作成・NDA/規約署名
      'csv_onsite',      -- その場CSV
      'csv_followup',    -- 2〜3日後CSV(先導)
      'trial',           -- トライアル中(2週間)
      'proposal',        -- 本契約提案
      'follow',          -- フォロー
      'won',             -- 受注
      'lost'             -- 失注
    )
  ),
  -- 商談の所有者(作成した maira admin)。表示・絞り込み用。
  owner_user_id uuid references auth.users(id) on delete set null,
  -- 自由メモ(機密性の高い内容は議事録側に置く前提で平文)
  notes text check (notes is null or length(notes) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_prospects_stage_idx on public.sales_prospects (stage, updated_at desc);
create index if not exists sales_prospects_owner_idx on public.sales_prospects (owner_user_id, created_at desc);

comment on table public.sales_prospects is
  '運営の営業パイプライン(Myaira を売る営業先の会社=商談)。is_maira_admin 限定。';

drop trigger if exists set_sales_prospects_updated_at on public.sales_prospects;
create trigger set_sales_prospects_updated_at
  before update on public.sales_prospects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 2. ミーティング(録音 / 議事録 / AIアドバイス)
-- ---------------------------------------------------------------------
create table if not exists public.sales_meetings (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.sales_prospects(id) on delete cascade,
  -- 何回目のミーティングか(表示・並び用)
  meeting_no integer not null default 1,
  -- そのミーティング時点のステージ(タグ。任意)
  stage text check (
    stage is null or stage in (
      'lead','sales_1','sales_2','test_decided','account_signed',
      'csv_onsite','csv_followup','trial','proposal','follow','won','lost'
    )
  ),
  title text check (title is null or length(title) <= 200),
  meeting_date date,
  -- 入力ソース:録音アップロード or テキスト貼り付け
  source text not null default 'upload' check (source in ('upload', 'text')),
  -- アップロード音声(Storage: sales-meeting-audio)。テキスト貼り付け時は null。
  storage_path text,
  original_filename text,
  size_bytes bigint,
  duration_seconds numeric,
  -- 処理状態(MVP は同期処理。processing → ready / failed)
  status text not null default 'processing' check (
    status in ('processing', 'ready', 'failed')
  ),
  status_message text,
  -- 機密テキストは暗号化して保存(v{n}:base64url 形式)。長文になりうるので上限は緩め。
  encrypted_transcript text,
  encrypted_minutes text,   -- AI 生成の議事録
  encrypted_advice text,    -- AI 生成の次アクション提案
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_meetings_prospect_idx
  on public.sales_meetings (prospect_id, meeting_no desc, created_at desc);

comment on table public.sales_meetings is
  '商談ごとのミーティング。録音→文字起こし→議事録→AI次アクション。機密テキストは暗号化。';

drop trigger if exists set_sales_meetings_updated_at on public.sales_meetings;
create trigger set_sales_meetings_updated_at
  before update on public.sales_meetings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RLS(すべて is_maira_admin 限定。INSERT は service_role のみ)
-- ---------------------------------------------------------------------
alter table public.sales_prospects enable row level security;
alter table public.sales_meetings enable row level security;

-- 共通の admin 判定(profiles.is_maira_admin)
-- sales_prospects
drop policy if exists "Maira admins can view sales_prospects" on public.sales_prospects;
create policy "Maira admins can view sales_prospects"
  on public.sales_prospects for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true));

drop policy if exists "Maira admins can update sales_prospects" on public.sales_prospects;
create policy "Maira admins can update sales_prospects"
  on public.sales_prospects for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true));

drop policy if exists "Maira admins can delete sales_prospects" on public.sales_prospects;
create policy "Maira admins can delete sales_prospects"
  on public.sales_prospects for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true));

-- sales_meetings
drop policy if exists "Maira admins can view sales_meetings" on public.sales_meetings;
create policy "Maira admins can view sales_meetings"
  on public.sales_meetings for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true));

drop policy if exists "Maira admins can update sales_meetings" on public.sales_meetings;
create policy "Maira admins can update sales_meetings"
  on public.sales_meetings for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true));

drop policy if exists "Maira admins can delete sales_meetings" on public.sales_meetings;
create policy "Maira admins can delete sales_meetings"
  on public.sales_meetings for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true));

-- ---------------------------------------------------------------------
-- 4. 専用の非公開ストレージ(sales-meeting-audio)
--    career-intake-audio と同じ MIME / サイズ上限。アクセスは is_maira_admin 限定。
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sales-meeting-audio',
  'sales-meeting-audio',
  false,
  26214400, -- 25 MiB
  array[
    'audio/mpeg','audio/mp3','audio/wav','audio/webm','audio/m4a','audio/mp4',
    'audio/x-m4a','audio/ogg','audio/flac','video/mp4','video/webm','video/quicktime'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Maira admins manage sales audio" on storage.objects;
create policy "Maira admins manage sales audio"
  on storage.objects for all
  using (
    bucket_id = 'sales-meeting-audio'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true)
  )
  with check (
    bucket_id = 'sales-meeting-audio'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true)
  );
