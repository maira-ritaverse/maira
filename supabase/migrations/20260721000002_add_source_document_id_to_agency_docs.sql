-- ============================================
-- 書類から起こした履歴書/職務経歴書のトレーサビリティ
--
-- 「アップロードした元書類(agency_client_source_documents)から AI 抽出して
--   新規作成した履歴書/CV」に、どの元書類由来かを刻む列を追加する。
-- 既存の source_recording_id(面談録音由来の打刻)と対称。
-- 元書類が削除されたら参照は NULL に落とす(履歴書/CV 自体は残す)。
-- ============================================
alter table public.agency_client_resumes
  add column if not exists source_document_id uuid
    references public.agency_client_source_documents(id) on delete set null;

alter table public.agency_client_cvs
  add column if not exists source_document_id uuid
    references public.agency_client_source_documents(id) on delete set null;

comment on column public.agency_client_resumes.source_document_id is
  'この履歴書を起こした元書類(agency_client_source_documents)。書類取り込み由来のみ非 NULL。';
comment on column public.agency_client_cvs.source_document_id is
  'この職務経歴書を起こした元書類(agency_client_source_documents)。書類取り込み由来のみ非 NULL。';
