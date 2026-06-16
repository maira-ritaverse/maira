-- =====================================================================
-- キャリア面談 音声/動画アップロード(career_intake_recordings)
--
-- 用途:
--   ・本人が「キャリア面談の録音」をアップロード
--   ・Whisper で文字起こし → Claude で構造化抽出
--   ・抽出結果から履歴書 / 職務経歴書を自動下書き
--
-- セキュリティ方針(ADR 0006):
--   ・音声ファイルそのものは Supabase Storage(private bucket)に保存
--   ・文字起こし結果 / 抽出 JSON は本テーブルに暗号化保存(AES-256-GCM)
--   ・本人のみ閲覧 / 削除可
--
-- 状態遷移:
--   uploaded → transcribing → transcribed → extracting → extracted
--               (失敗時はそれぞれ failed_xxx)
-- =====================================================================

create table if not exists public.career_intake_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Storage パス("private/career-intake/{user_id}/{id}.{ext}" 想定)
  storage_path text not null,
  -- 表示用ファイル名 + サイズ
  original_filename text not null,
  size_bytes integer not null check (size_bytes >= 0),
  duration_seconds integer,
  -- 状態
  status text not null default 'uploaded'
    check (status in (
      'uploaded',
      'transcribing', 'transcribed', 'failed_transcribe',
      'extracting',   'extracted',   'failed_extract'
    )),
  status_message text,
  -- 暗号化保存(AES-256-GCM、lib/crypto/field-encryption の v{n}: 形式)
  -- 文字起こし生テキスト
  encrypted_transcript text,
  -- Claude による抽出 JSON(履歴書 / 職務経歴書の構造化下書き)
  encrypted_extraction text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cir_user_created_idx
  on public.career_intake_recordings (user_id, created_at desc);

drop trigger if exists set_cir_updated_at on public.career_intake_recordings;
create trigger set_cir_updated_at
  before update on public.career_intake_recordings
  for each row execute function public.set_updated_at();

comment on table public.career_intake_recordings is
  'キャリア面談の音声/動画アップロード(Whisper + Claude で履歴書下書きを生成)';

-- ===========================
-- RLS:本人のみ
-- ===========================
alter table public.career_intake_recordings enable row level security;

drop policy if exists "Users can manage own career intake recordings"
  on public.career_intake_recordings;
create policy "Users can manage own career intake recordings"
  on public.career_intake_recordings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===========================
-- Storage bucket(private)
-- ===========================
-- bucket は SQL で直接 insert(SDK / CLI のどちらでも作れるが、マイグレーションに残す方が再現性が高い)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'career-intake-audio',
  'career-intake-audio',
  false,
  -- 25 MiB(Whisper API の単一リクエスト上限に合わせる)
  26214400,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/m4a',
    'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/flac',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do nothing;

-- Storage の RLS:オブジェクトのパスを user_id 始まりに固定し、所有者のみ操作可
-- パス構造:"{user_id}/{recording_id}.{ext}"(先頭セグメント = user_id を強制)
drop policy if exists "Users can upload own intake audio" on storage.objects;
create policy "Users can upload own intake audio"
  on storage.objects for insert
  with check (
    bucket_id = 'career-intake-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read own intake audio" on storage.objects;
create policy "Users can read own intake audio"
  on storage.objects for select
  using (
    bucket_id = 'career-intake-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own intake audio" on storage.objects;
create policy "Users can delete own intake audio"
  on storage.objects for delete
  using (
    bucket_id = 'career-intake-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
