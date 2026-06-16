-- =====================================================================
-- career_intake_recordings に「外部ソース」由来の録音を扱う列を追加
--
-- 用途:
--   ・Zoom Webhook(recording.completed)受信時に「これからダウンロードする
--     録画」のプレースホルダ行を作る
--   ・Pickup ジョブが external_download_url から fetch して Storage に置く
--
-- storage_path は外部行が作られた時点では空。Pickup 完了後に埋まる。
-- ─────────────────────────────────────────────────────────────────────
alter table public.career_intake_recordings
  add column if not exists external_source text
    check (external_source is null or external_source in ('zoom', 'google_drive')),
  add column if not exists external_meeting_id text,
  add column if not exists external_recording_id text,
  add column if not exists external_download_url text;

-- storage_path は外部ソース時に後埋めする(初期 NULL を許容)
alter table public.career_intake_recordings
  alter column storage_path drop not null;

-- 既存ステータスに 'external_pending' を追加(まだ Storage に無い状態)
alter table public.career_intake_recordings
  drop constraint if exists career_intake_recordings_status_check;
alter table public.career_intake_recordings
  add constraint career_intake_recordings_status_check
  check (status in (
    'uploaded',
    'external_pending',
    'transcribing', 'transcribed', 'failed_transcribe',
    'extracting',   'extracted',   'failed_extract'
  ));

-- pickup 用インデックス(外部行を拾うクエリを高速化)
create index if not exists cir_external_pickup_idx
  on public.career_intake_recordings (status, processing_lease_until)
  where status = 'external_pending';

create index if not exists cir_external_dedup_idx
  on public.career_intake_recordings (external_source, external_recording_id)
  where external_recording_id is not null;
