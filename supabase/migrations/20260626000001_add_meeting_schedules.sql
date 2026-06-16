-- ============================================================================
-- meeting_schedules:Zoom / Google Meet 個人接続経由の面談予約テーブル
--
-- 目的:
--   ・エージェント本人の Zoom / Google アカウントで作成した会議を Maira 側に
--     紐づけ管理する
--   ・求職者(client_records / auth.users)に対する招待 / リマインダー /
--     録画取込との突合 を一元化
--
-- 設計判断:
--   ・provider を tagged column にして Zoom / Google Meet を同列で扱う
--   ・external_meeting_id は provider 単位でユニーク(同じ ID 衝突は別 provider 間
--     ではあり得る)
--   ・組織所属しているエージェント前提だが、organization_id は host から自動導出
--     のため NULLABLE(将来 freelancer 単独利用を考慮)
--   ・agenda は機密寄り(求職者の課題感を書く)なので暗号化対象に追加
--   ・recording_id は intake_recordings 側の uuid を載せる(取込完了でセット)
--
-- RLS:
--   ・SELECT:組織メンバ全員
--   ・INSERT / UPDATE:host 本人 + 組織 admin
--   ・DELETE:host 本人 + 組織 admin
--
-- 既存資産:
--   ・組織判定は current_user_organization_id() ヘルパ
--   ・admin 判定は current_user_organization_role() ヘルパ(既存)
-- ============================================================================

create table if not exists public.meeting_schedules (
  id uuid primary key default gen_random_uuid(),

  -- 組織(host の所属組織。NULL は単独利用想定の予備枠)
  organization_id uuid references public.organizations(id) on delete cascade,

  -- 主催者(必ずエージェント側のエージェントメンバー)
  host_user_id uuid not null references auth.users(id) on delete cascade,

  -- 相手(求職者)
  --   client_record_id:エージェントが管理する求職者レコード
  --   seeker_user_id  :相手が Maira ユーザでもある場合の auth.users 紐づけ
  client_record_id uuid references public.client_records(id) on delete set null,
  seeker_user_id uuid references auth.users(id) on delete set null,
  -- 招待先メールアドレス(Maira 未登録の求職者に送るケース)
  invitee_email text,

  -- 会議情報
  provider text not null check (provider in ('zoom', 'google_meet')),
  external_meeting_id text not null,
  join_url text not null,
  -- 主催者専用 URL(Zoom のみ、Google Meet は join_url と同じ)
  host_url text,
  -- パスコード(Zoom のみ。ホスト用に保存)
  passcode text,

  -- 予定
  title text not null,
  -- 議題は機密(求職者の悩み・目標が入りうる)→ 暗号化
  encrypted_agenda text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Tokyo',

  -- ステータス遷移
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'canceled', 'no_show')),

  -- 招待管理
  invited_at timestamptz,
  reminder_24h_sent_at timestamptz,
  reminder_1h_sent_at timestamptz,

  -- 録画リンク(取込み完了後にセット)
  recording_id uuid references public.career_intake_recordings(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── インデックス ────────────────────────────────────────────────────────
-- ダッシュボード「直近の予定」が starts_at 昇順での主クエリ
create index if not exists idx_meeting_schedules_host_starts
  on public.meeting_schedules (host_user_id, starts_at);

-- クライアント詳細で「このクライアントの面談履歴」
create index if not exists idx_meeting_schedules_client_starts
  on public.meeting_schedules (client_record_id, starts_at desc)
  where client_record_id is not null;

-- 組織カレンダー画面
create index if not exists idx_meeting_schedules_org_starts
  on public.meeting_schedules (organization_id, starts_at)
  where organization_id is not null;

-- Webhook(Zoom/Google)が external_meeting_id で照合する
create unique index if not exists idx_meeting_schedules_provider_external_unique
  on public.meeting_schedules (provider, external_meeting_id);

-- リマインダー Cron が「window に入っている予定」を引く
create index if not exists idx_meeting_schedules_status_starts
  on public.meeting_schedules (status, starts_at);

-- ─── updated_at トリガ ──────────────────────────────────────────────────
drop trigger if exists set_meeting_schedules_updated_at on public.meeting_schedules;
create trigger set_meeting_schedules_updated_at
  before update on public.meeting_schedules
  for each row execute function public.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────
alter table public.meeting_schedules enable row level security;

-- SELECT:同じ組織メンバなら閲覧可
drop policy if exists "Members can view org meeting schedules" on public.meeting_schedules;
create policy "Members can view org meeting schedules"
  on public.meeting_schedules for select
  using (
    organization_id = public.current_user_organization_id()
    or host_user_id = auth.uid()
    or seeker_user_id = auth.uid()
  );

-- INSERT:host 本人(エージェントメンバ)
drop policy if exists "Host can insert meeting schedules" on public.meeting_schedules;
create policy "Host can insert meeting schedules"
  on public.meeting_schedules for insert
  with check (
    host_user_id = auth.uid()
    and (
      organization_id is null
      or organization_id = public.current_user_organization_id()
    )
  );

-- UPDATE:host 本人 もしくは 組織 admin
drop policy if exists "Host or admin can update meeting schedules" on public.meeting_schedules;
create policy "Host or admin can update meeting schedules"
  on public.meeting_schedules for update
  using (
    host_user_id = auth.uid()
    or (
      organization_id = public.current_user_organization_id()
      and public.current_user_organization_role() = 'admin'
    )
  );

-- DELETE:host 本人 もしくは 組織 admin
drop policy if exists "Host or admin can delete meeting schedules" on public.meeting_schedules;
create policy "Host or admin can delete meeting schedules"
  on public.meeting_schedules for delete
  using (
    host_user_id = auth.uid()
    or (
      organization_id = public.current_user_organization_id()
      and public.current_user_organization_role() = 'admin'
    )
  );

comment on table public.meeting_schedules is
  'Zoom / Google Meet の個人接続経由で作成した面談予約。録画取込・リマインダーの基点';
comment on column public.meeting_schedules.encrypted_agenda is
  '議題(AES-256-GCM 暗号化、lib/crypto/field-encryption の v{n}: 形式)';
comment on column public.meeting_schedules.recording_id is
  '取込完了後に career_intake_recordings.id をセット(Webhook/Poll 側で更新)';

-- ============================================================================
-- career_intake_recordings に「面談紐づけ」用カラムを追加
--
-- 既存テーブルは「求職者本人の棚卸し録音」だけを想定していたが、エージェント
-- 面談の録音も同じパイプライン(Whisper + Claude)で処理したいので、
-- meeting_schedule_id / client_record_id / transcript_purpose を追加する。
-- 既存行は transcript_purpose='self_intake' のままで運用継続。
-- ============================================================================

alter table public.career_intake_recordings
  add column if not exists meeting_schedule_id uuid references public.meeting_schedules(id) on delete set null,
  add column if not exists client_record_id uuid references public.client_records(id) on delete set null,
  add column if not exists transcript_purpose text
    not null default 'self_intake'
    check (transcript_purpose in ('self_intake', 'agency_interview', 'meeting_record'));

create index if not exists idx_cir_meeting_schedule
  on public.career_intake_recordings (meeting_schedule_id)
  where meeting_schedule_id is not null;

create index if not exists idx_cir_client_record
  on public.career_intake_recordings (client_record_id)
  where client_record_id is not null;

comment on column public.career_intake_recordings.transcript_purpose is
  'self_intake = 求職者本人の棚卸し / agency_interview = エージェント面談 / meeting_record = 一般メモ';

-- ============================================================================
-- zoom_connections / google_connections に scopes_granted を追加
--
-- 「meeting:write が認可されているか?」を毎回 scope テキストから判定するのは
-- 効率が悪い + バグりやすい。トークン交換時にパースした結果を text[] で持つ。
-- ============================================================================

alter table public.zoom_connections
  add column if not exists scopes_granted text[] not null default array[]::text[];

alter table public.google_connections
  add column if not exists scopes_granted text[] not null default array[]::text[];

comment on column public.zoom_connections.scopes_granted is
  'Zoom 認可で取得したスコープ配列。UI 側で「再認可が必要」を判定する';
comment on column public.google_connections.scopes_granted is
  'Google 認可で取得したスコープ配列。calendar.events が含まれているか判定する';
