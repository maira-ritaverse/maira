-- ============================================
-- agency_client_source_documents
--
-- 目的:
--   エージェント が 求職者 の 既存 履歴書 / 職務経歴書 (PDF / 画像) を そのまま
--   保存 する 元書類。 従来 の agency_client_resumes / agency_client_cvs は
--   構造化 JSON 前提 で AI 生成 素材 だった が、 実運用 で は 「既に 出来上がった
--   PDF を そのまま 手元 に 置きたい (求人企業 に そのまま 提出、 後日 参照 用)」
--   ニーズ が あり、 別 テーブル + 別 バケット で 元 バイナリ を 保存 する。
--
--   Phase 2 では 本 テーブル の 行 を トリガー に Claude Vision で 中身 を 抽出
--   → CRM プロフィール (client_records の 各 フィールド) に 反映 する。
--
-- 設計 メモ:
--   ・ファイル 本体 は Storage バケット (agency-client-source-documents)、
--     path 先頭 = organization_id で RLS 強制 (agency-client-photos と同型)
--   ・DB 行 は メタデータ のみ (path, file_name, mime_type, size)。 バイナリ は
--     持たない
--   ・形式 は PDF / JPEG / PNG に 限定 (Claude Vision が Phase 2 で 直読み できる)。
--     DOCX は 現時点 で 非対応 (ユーザー 側 で PDF 変換 して もらう 運用)
--   ・上限 20 MB (Storage bucket 制約 + アプリ 側 の 二重 検証)
-- ============================================

create table if not exists public.agency_client_source_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,

  -- 用途 タグ (UI 上 の フィルタ / Phase 2 で 抽出 方針 を 分岐 する 用)
  document_type text not null default 'other'
    check (document_type in ('resume', 'cv', 'other')),

  -- 元 の ファイル 名 (ダウンロード 時 に この 名前 で 返す)
  file_name text not null check (length(file_name) between 1 and 255),
  mime_type text not null
    check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),

  -- Storage バケット (agency-client-source-documents) 内 の フルパス
  -- 形式: {organization_id}/{client_record_id}/{id}.{ext}
  storage_path text not null unique,

  -- 元 ファイル サイズ (バイト)。 UI 表示 用
  file_size int not null check (file_size > 0 and file_size <= 20971520),

  uploaded_by_member_id uuid references public.organization_members(id) on delete set null,

  -- 任意 メモ (Phase 1 では UI 未実装、将来 追加 する ため に 予約)
  notes text check (notes is null or length(notes) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agency_client_source_documents is
  'エージェント が 求職者 の 既存 履歴書 / 職務経歴書 (PDF / 画像) を そのまま 保存 する 元書類。 バイナリ は Storage、 DB は メタ のみ。';

create index if not exists idx_acsd_client
  on public.agency_client_source_documents(client_record_id, created_at desc);
create index if not exists idx_acsd_org
  on public.agency_client_source_documents(organization_id);

-- ============================================
-- RLS
-- ============================================
alter table public.agency_client_source_documents enable row level security;

drop policy if exists acsd_select on public.agency_client_source_documents;
create policy acsd_select
  on public.agency_client_source_documents for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists acsd_insert on public.agency_client_source_documents;
create policy acsd_insert
  on public.agency_client_source_documents for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists acsd_update on public.agency_client_source_documents;
create policy acsd_update
  on public.agency_client_source_documents for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists acsd_delete on public.agency_client_source_documents;
create policy acsd_delete
  on public.agency_client_source_documents for delete
  using (organization_id = public.current_user_organization_id());

-- updated_at trigger
drop trigger if exists acsd_set_updated_at on public.agency_client_source_documents;
create trigger acsd_set_updated_at
  before update on public.agency_client_source_documents
  for each row execute function public.set_updated_at();

-- ============================================
-- Storage bucket
-- ============================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agency-client-source-documents',
  'agency-client-source-documents',
  false,
  20 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS: path 先頭 = organization_id (agency-client-photos と 同型)
drop policy if exists "Org members can read agency-client-source-documents"
  on storage.objects;
create policy "Org members can read agency-client-source-documents"
  on storage.objects for select
  using (
    bucket_id = 'agency-client-source-documents'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );

drop policy if exists "Org members can insert agency-client-source-documents"
  on storage.objects;
create policy "Org members can insert agency-client-source-documents"
  on storage.objects for insert
  with check (
    bucket_id = 'agency-client-source-documents'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );

drop policy if exists "Org members can update agency-client-source-documents"
  on storage.objects;
create policy "Org members can update agency-client-source-documents"
  on storage.objects for update
  using (
    bucket_id = 'agency-client-source-documents'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  )
  with check (
    bucket_id = 'agency-client-source-documents'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );

drop policy if exists "Org members can delete agency-client-source-documents"
  on storage.objects;
create policy "Org members can delete agency-client-source-documents"
  on storage.objects for delete
  using (
    bucket_id = 'agency-client-source-documents'
    and (split_part(name, '/', 1))::uuid = public.current_user_organization_id()
  );
