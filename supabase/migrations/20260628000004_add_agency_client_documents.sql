-- =====================================================================
-- エージェントが「クライアント本人(求職者)に代わって」作成・保管する
-- 履歴書 / 職務経歴書 / 証明写真 / ヒアリングシート / 代行応募 一式
--
-- 設計判断:
--   ・既存の求職者所有テーブル(public.resumes / public.cvs)とは別軸に
--     する。所有者は組織(organization_id + client_record_id)。
--     - 連携前のクライアントにも資料を作れる
--     - エージェント独自の編集を求職者の self-edit と分離して履歴管理
--   ・連携後は document_drafts_from_agency 経由で seeker に「受領」して
--     もらう既存フローを温存(本マイグレーションでは新規 FK のみ)
--   ・暗号化方針:lib/crypto/field-encryption.ts(AES-256-GCM v{n}: prefix)
--   ・全テーブルで RLS は public.current_user_organization_id() を
--     organization_id にマッチで強制。同組織のメンバーは読み書き可、
--     物理削除は組織 admin のみ(履歴改ざんを防ぐ)。
--
-- 追加するテーブル:
--   1. agency_client_resumes  履歴書(下書き / 確定)
--   2. agency_client_cvs      職務経歴書(下書き / 確定)
--   3. agency_client_photos   証明写真(storage path + metadata 行)
--   4. hearing_sheets         ヒアリングシート(面談中の構造化入力)
--   5. agency_applications    代行応募(referral と 1:1)
--
-- 追加する Storage バケット:
--   - agency-client-photos(private、組織配下のクライアント写真)
--
-- 影響範囲:
--   ・既存テーブル無変更
--   ・RLS 既存ポリシー無変更
-- =====================================================================

-- ───────────────────────────────────────────────────────────────────
-- 1. agency_client_resumes
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.agency_client_resumes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,

  -- ファイル名相当のタイトル(平文)
  title text not null check (length(title) between 1 and 200),
  -- 履歴書様式 上の日付
  document_date date,

  -- 履歴書 本人情報 一式(氏名 / 住所 / 学歴 / 職歴 等)を AES-256-GCM 暗号化
  -- 保存形式は v{n}:base64url(iv ‖ ct+authTag)
  encrypted_pii text not null check (length(encrypted_pii) <= 32000),

  -- 学歴 / 職歴 / 資格は構造化のまま jsonb(機密だが暗号化不要レベル:
  --   学校名・在籍年月。氏名 / 住所のような直接的 PII ではない)
  education_history jsonb not null default '[]'::jsonb,
  licenses jsonb not null default '[]'::jsonb,

  -- 証明写真の Storage パス(agency-client-photos バケット内のフルパス)
  photo_storage_path text,

  -- 状態:draft = 編集中 / final = 確定済み(求人企業提出可能)
  status text not null default 'draft'
    check (status in ('draft', 'final')),

  -- AI 抽出由来か(career_intake_recordings 経由で作られたもの)
  source_recording_id uuid references public.career_intake_recordings(id) on delete set null,
  -- 連携した hearing_sheet(あれば)
  source_hearing_sheet_id uuid,

  -- linked seeker に送付したときの drafts レコード(Phase 8 で使う)
  pushed_to_draft_id uuid references public.document_drafts_from_agency(id) on delete set null,

  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agency_client_resumes is
  'エージェントが作成・管理する履歴書。組織所有(client_record_id 単位)。AES-256-GCM。';
comment on column public.agency_client_resumes.encrypted_pii is
  'AES-256-GCM(v{n}:base64url(iv ‖ ct+tag))。lib/crypto/field-encryption.ts で復号。';
comment on column public.agency_client_resumes.photo_storage_path is
  'agency-client-photos バケット内のパス。null は写真未登録。';

create index if not exists idx_agency_client_resumes_client
  on public.agency_client_resumes (client_record_id, created_at desc);
create index if not exists idx_agency_client_resumes_org
  on public.agency_client_resumes (organization_id);

drop trigger if exists set_agency_client_resumes_updated_at
  on public.agency_client_resumes;
create trigger set_agency_client_resumes_updated_at
  before update on public.agency_client_resumes
  for each row execute function public.set_updated_at();

alter table public.agency_client_resumes enable row level security;

-- 同組織メンバーは閲覧 / 追加 / 編集可
drop policy if exists "Members can view agency_client_resumes"
  on public.agency_client_resumes;
create policy "Members can view agency_client_resumes"
  on public.agency_client_resumes for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Members can insert agency_client_resumes"
  on public.agency_client_resumes;
create policy "Members can insert agency_client_resumes"
  on public.agency_client_resumes for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Members can update agency_client_resumes"
  on public.agency_client_resumes;
create policy "Members can update agency_client_resumes"
  on public.agency_client_resumes for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

-- 物理削除は admin のみ(履歴改ざん抑止)
drop policy if exists "Admins can delete agency_client_resumes"
  on public.agency_client_resumes;
create policy "Admins can delete agency_client_resumes"
  on public.agency_client_resumes for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );


-- ───────────────────────────────────────────────────────────────────
-- 2. agency_client_cvs(職務経歴書)
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.agency_client_cvs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,

  title text not null check (length(title) between 1 and 200),
  document_date date,

  -- 本文(自由記述 + 構造化メタ)を JSON 化して AES-256-GCM 暗号化
  encrypted_body text not null check (length(encrypted_body) <= 64000),

  -- 履歴書とリンクして「同じ人物の CV」を表すための任意リンク
  related_resume_id uuid references public.agency_client_resumes(id) on delete set null,

  status text not null default 'draft'
    check (status in ('draft', 'final')),

  source_recording_id uuid references public.career_intake_recordings(id) on delete set null,
  source_hearing_sheet_id uuid,

  pushed_to_draft_id uuid references public.document_drafts_from_agency(id) on delete set null,

  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agency_client_cvs is
  'エージェントが作成・管理する職務経歴書。組織所有。AES-256-GCM。';

create index if not exists idx_agency_client_cvs_client
  on public.agency_client_cvs (client_record_id, created_at desc);
create index if not exists idx_agency_client_cvs_org
  on public.agency_client_cvs (organization_id);

drop trigger if exists set_agency_client_cvs_updated_at
  on public.agency_client_cvs;
create trigger set_agency_client_cvs_updated_at
  before update on public.agency_client_cvs
  for each row execute function public.set_updated_at();

alter table public.agency_client_cvs enable row level security;

drop policy if exists "Members can view agency_client_cvs"
  on public.agency_client_cvs;
create policy "Members can view agency_client_cvs"
  on public.agency_client_cvs for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Members can insert agency_client_cvs"
  on public.agency_client_cvs;
create policy "Members can insert agency_client_cvs"
  on public.agency_client_cvs for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Members can update agency_client_cvs"
  on public.agency_client_cvs;
create policy "Members can update agency_client_cvs"
  on public.agency_client_cvs for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Admins can delete agency_client_cvs"
  on public.agency_client_cvs;
create policy "Admins can delete agency_client_cvs"
  on public.agency_client_cvs for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );


-- ───────────────────────────────────────────────────────────────────
-- 3. agency_client_photos(証明写真の管理 行)
--    実体は Storage バケット agency-client-photos にあり、本テーブルは
--    メタ情報(誰がいつアップロードしたか、原寸サイズ等)を保持する。
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.agency_client_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,

  -- agency-client-photos バケット内の オブジェクトパス
  --   例:{organization_id}/{client_record_id}/{photo_id}.jpg
  storage_path text not null,

  -- 平文:bytes / 縦横(JPEG 正規化後)
  bytes integer,
  width integer,
  height integer,

  uploaded_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.agency_client_photos is
  'エージェントがクライアントの履歴書用に保管する証明写真の メタ情報。'
  ' 実体は Storage バケット agency-client-photos にある。';

create index if not exists idx_agency_client_photos_client
  on public.agency_client_photos (client_record_id, created_at desc);

alter table public.agency_client_photos enable row level security;

drop policy if exists "Members can view agency_client_photos"
  on public.agency_client_photos;
create policy "Members can view agency_client_photos"
  on public.agency_client_photos for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Members can insert agency_client_photos"
  on public.agency_client_photos;
create policy "Members can insert agency_client_photos"
  on public.agency_client_photos for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Admins can delete agency_client_photos"
  on public.agency_client_photos;
create policy "Admins can delete agency_client_photos"
  on public.agency_client_photos for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );


-- ───────────────────────────────────────────────────────────────────
-- 4. hearing_sheets(ヒアリングシート)
--    面談中 / 後にエージェントが入力する構造化フォーム。
--    AI 抽出値とのギャップを手動で埋める用途。
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.hearing_sheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  meeting_schedule_id uuid references public.meeting_schedules(id) on delete set null,

  -- フォームのフィールド集合(JSON)を AES-256-GCM 暗号化
  --   例:{ current_job, strengths, desired_industry, motivation, ... }
  encrypted_content text not null check (length(encrypted_content) <= 64000),

  -- AI 抽出元の録音(あれば)
  source_recording_id uuid references public.career_intake_recordings(id) on delete set null,
  ai_extracted_at timestamptz,
  human_reviewed_at timestamptz,

  status text not null default 'draft'
    check (status in ('draft', 'finalized')),

  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hearing_sheets is
  '面談中 / 後の構造化ヒアリング入力。AES-256-GCM。AI 抽出と差分照合する用途。';

create index if not exists idx_hearing_sheets_client
  on public.hearing_sheets (client_record_id, created_at desc);
create index if not exists idx_hearing_sheets_meeting
  on public.hearing_sheets (meeting_schedule_id)
  where meeting_schedule_id is not null;

drop trigger if exists set_hearing_sheets_updated_at
  on public.hearing_sheets;
create trigger set_hearing_sheets_updated_at
  before update on public.hearing_sheets
  for each row execute function public.set_updated_at();

alter table public.hearing_sheets enable row level security;

drop policy if exists "Members can view hearing_sheets"
  on public.hearing_sheets;
create policy "Members can view hearing_sheets"
  on public.hearing_sheets for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Members can insert hearing_sheets"
  on public.hearing_sheets;
create policy "Members can insert hearing_sheets"
  on public.hearing_sheets for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Members can update hearing_sheets"
  on public.hearing_sheets;
create policy "Members can update hearing_sheets"
  on public.hearing_sheets for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Admins can delete hearing_sheets"
  on public.hearing_sheets;
create policy "Admins can delete hearing_sheets"
  on public.hearing_sheets for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- 1, 2 の FK を遅延付与(hearing_sheets が後に作られるため、循環を avoid)
alter table public.agency_client_resumes
  add constraint agency_client_resumes_source_hearing_sheet_fk
  foreign key (source_hearing_sheet_id)
  references public.hearing_sheets(id) on delete set null;

alter table public.agency_client_cvs
  add constraint agency_client_cvs_source_hearing_sheet_fk
  foreign key (source_hearing_sheet_id)
  references public.hearing_sheets(id) on delete set null;


-- ───────────────────────────────────────────────────────────────────
-- 5. agency_applications(代行応募)
--    referral(紹介)と 1:1。「実際に応募を投函した」結果と進捗を保持。
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.agency_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  referral_id uuid not null references public.referrals(id) on delete cascade,

  -- 応募詳細(自由記述 + 進捗メモ)を AES-256-GCM 暗号化
  --   例:{ applied_via, contact_name, status_memo, next_action_at, ... }
  encrypted_details text not null check (length(encrypted_details) <= 32000),

  -- 簡易ステータス(referral.status とは独立に「応募」単位の状態を持つ)
  status text not null default 'submitted'
    check (status in ('submitted', 'screening', 'interview', 'offer', 'rejected', 'withdrawn')),
  applied_at timestamptz not null default now(),

  applied_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 1 つの referral に対して 1 つの代行応募(重複応募は別 referral を作る運用)
  unique (referral_id)
);

comment on table public.agency_applications is
  'エージェントが クライアントに代わって 求人に出した代行応募。referral と 1:1。';

create index if not exists idx_agency_applications_client
  on public.agency_applications (client_record_id, created_at desc);
create index if not exists idx_agency_applications_org
  on public.agency_applications (organization_id);

drop trigger if exists set_agency_applications_updated_at
  on public.agency_applications;
create trigger set_agency_applications_updated_at
  before update on public.agency_applications
  for each row execute function public.set_updated_at();

alter table public.agency_applications enable row level security;

drop policy if exists "Members can view agency_applications"
  on public.agency_applications;
create policy "Members can view agency_applications"
  on public.agency_applications for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Members can insert agency_applications"
  on public.agency_applications;
create policy "Members can insert agency_applications"
  on public.agency_applications for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Members can update agency_applications"
  on public.agency_applications;
create policy "Members can update agency_applications"
  on public.agency_applications for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Admins can delete agency_applications"
  on public.agency_applications;
create policy "Admins can delete agency_applications"
  on public.agency_applications for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );


-- ───────────────────────────────────────────────────────────────────
-- 6. Storage バケット agency-client-photos
--    private(public=false)。MIME は image/jpeg / image/png / image/webp。
--    1 ファイル上限 10 MB。
-- ───────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agency-client-photos',
  'agency-client-photos',
  false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS:同組織配下のオブジェクトのみ S/I/U/D 可
-- パスは {organization_id}/{client_record_id}/{photo_id}.jpg を前提とし、
-- パスの先頭セグメント(split_part(name, '/', 1))が現ユーザ organization_id と一致する場合のみ通す。
drop policy if exists "Org members can read agency-client-photos"
  on storage.objects;
create policy "Org members can read agency-client-photos"
  on storage.objects for select
  using (
    bucket_id = 'agency-client-photos'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );

drop policy if exists "Org members can insert agency-client-photos"
  on storage.objects;
create policy "Org members can insert agency-client-photos"
  on storage.objects for insert
  with check (
    bucket_id = 'agency-client-photos'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );

drop policy if exists "Org members can update agency-client-photos"
  on storage.objects;
create policy "Org members can update agency-client-photos"
  on storage.objects for update
  using (
    bucket_id = 'agency-client-photos'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  )
  with check (
    bucket_id = 'agency-client-photos'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );

drop policy if exists "Org members can delete agency-client-photos"
  on storage.objects;
create policy "Org members can delete agency-client-photos"
  on storage.objects for delete
  using (
    bucket_id = 'agency-client-photos'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );
