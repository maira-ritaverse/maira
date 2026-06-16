-- =====================================================================
-- AI ヒアリングのバックグラウンドジョブ用カラム追加
--
-- ロードマップ「Phase 2:案 B(Background Job)」の基盤。
--   - processing_started_at:実際に worker が処理を始めた時刻
--   - processing_lease_until:この時刻までは他の worker が拾わない(リース失効後は再取得可)
--   - retry_count:バックオフ判定に使う
--
-- 同期処理(現行)は変更しない。pickup endpoint が拾うのは
-- "uploaded で processing_lease_until が null or 過去" の行のみ。
-- =====================================================================

alter table public.career_intake_recordings
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_lease_until timestamptz,
  add column if not exists retry_count integer not null default 0
    check (retry_count >= 0 and retry_count < 100);

-- pickup を高速にするためのインデックス
create index if not exists cir_pickup_idx
  on public.career_intake_recordings (status, processing_lease_until)
  where status = 'uploaded';

comment on column public.career_intake_recordings.processing_lease_until is
  'pickup worker のリース期限。これより未来なら別 worker は拾わない';
comment on column public.career_intake_recordings.retry_count is
  '失敗時のバックオフ判定用。0 から始まる';
