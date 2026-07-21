-- ============================================
-- LINE WORKS 連携 (Phase 1: DB スキーマ)
--
-- 仕様: docs/line-works-integration-design.md
--
-- 用途:
--   ・(A) 社内共有連携 — アドバイザーへの通知 / チーム共有チャンネル投稿
--   ・(C) カレンダー連携 — 面談スケジュールを LINE WORKS カレンダーへ同期
--   ※ (B) 候補者コミュニケーションは対象外(設計書 第2章の技術制約による)
--
-- 構成テーブル:
--   ・lineworks_channels     — org ごとの LINE WORKS 接続設定 (資格情報を暗号化)
--   ・lineworks_user_links   — LINE WORKS userId ↔ Maira メンバー / (将来)候補者 の紐付け
--   ・lineworks_messages     — 送受信メッセージ (encrypted_content)
--   ・meeting_external_syncs — 面談 ↔ 外部カレンダー(Google / LINE WORKS)の同期台帳
--
-- 認証の要点(既存 LINE との最大の差):
--   LINE WORKS は Service Account の JWT(RS256)から短命アクセストークンを発行する。
--   よって固定トークンではなく client_secret / private_key を暗号化保管し、
--   サーバ側でトークンを都度発行・キャッシュする(access_token_* カラム)。
--
-- 書き込み方針(既存 LINE と同一流儀):
--   ・SELECT は同 org メンバー
--   ・INSERT / UPDATE / DELETE は service_role 経由のみ(API ハンドラで認可)
-- ============================================


-- ============================================
-- 1. lineworks_channels (org ごとの LINE WORKS 接続)
-- ============================================
create table if not exists public.lineworks_channels (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,

  -- テナント / アプリ 識別(公開情報、平文)
  domain_id text,               -- LINE WORKS テナントの domainId
  client_id text not null,      -- Developer Console のアプリ Client ID
  service_account text not null, -- Service Account(メール形式、JWT の sub)
  bot_id text,                  -- Bot ID(送受信の主体)

  -- 機密(lib/crypto/field-encryption の v{n}: 形式で暗号化)
  client_secret_encrypted text not null,   -- アプリ Client Secret
  private_key_encrypted text not null,      -- JWT 署名用 RSA 秘密鍵(PKCS8/PEM)
  bot_secret_encrypted text,                -- Callback 署名検証鍵(X-WORKS-Signature)

  -- 発行要求するスコープ(カンマ区切り。例: 'bot,bot.message,directory.read,calendar')
  scopes text not null default 'bot,bot.message,directory.read,calendar',

  -- アクセストークンのキャッシュ(短命。発行のたびに更新)
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,

  -- Webhook URL に含めるトークン(推測困難な 32 文字ランダム)
  -- LINE WORKS Bot Callback → Maira: /api/webhooks/lineworks/{webhook_token}
  webhook_token text not null unique,

  -- 機能フラグ
  notify_enabled boolean not null default true,        -- 用途A: 社内通知
  share_channel_id text,                                -- 用途A: チーム共有チャンネル(任意)
  calendar_sync_enabled boolean not null default true, -- 用途C: カレンダー同期
  candidate_channel_enabled boolean not null default false, -- 用途B(対象外): 既定 false

  -- 状態
  is_active boolean not null default true,
  last_verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lineworks_channels is
  'エージェント企業の LINE WORKS 連携設定。1 org 1 row。各社オプトイン。';
comment on column public.lineworks_channels.private_key_encrypted is
  'JWT(RS256)署名用の RSA 秘密鍵。v{n}: 形式で暗号化。平文をログ/ブラウザに出さない。';
comment on column public.lineworks_channels.bot_secret_encrypted is
  'Bot Callback の X-WORKS-Signature(HMAC-SHA256)検証鍵。v{n}: 形式で暗号化。';
comment on column public.lineworks_channels.access_token_encrypted is
  '発行済みアクセストークンのキャッシュ(短命)。token_expires_at まで再利用。';


-- ============================================
-- 2. lineworks_user_links
--    LINE WORKS userId ↔ Maira メンバー(用途A)/(将来)候補者(用途B)/ チャンネル
-- ============================================
create table if not exists public.lineworks_user_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- 相手の LINE WORKS 識別(公開情報、平文)
  lineworks_user_id text,   -- kind='member' / 'external' のとき
  channel_id text,          -- kind='channel' のとき(トークルーム)
  kind text not null check (kind in ('member', 'external', 'channel')),

  -- 用途A: Maira アドバイザーへのマッピング(kind='member')
  member_user_id uuid references auth.users(id) on delete set null,
  -- Directory 突合用(メール検索 API が無いため email 一致で解決)
  email text,

  -- 用途B(将来): 候補者プロファイルへの紐付け(kind='external')
  client_record_id uuid references public.client_records(id) on delete set null,

  -- プロフィール(平文)
  display_name text,

  -- 会話運用(既存 line_user_links に倣う)
  handled_at timestamptz,
  last_activity_at timestamptz,
  unfollowed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 1 org 内で userId / channelId は一意
  unique (organization_id, lineworks_user_id),
  unique (organization_id, channel_id)
);

comment on table public.lineworks_user_links is
  'LINE WORKS の userId / チャンネル と Maira メンバー(用途A)や候補者(用途B, 将来)の紐付け。';


-- ============================================
-- 3. lineworks_messages (送受信ログ)
-- ============================================
create table if not exists public.lineworks_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- 宛先/送信元(userId か channelId のどちらか)
  lineworks_user_id text,
  channel_id text,

  direction text not null check (direction in ('inbound', 'outbound')),
  -- LINE WORKS の content.type(text / button_template / list_template / flex / carousel / image / file / sticker)
  -- + system(参加/退出などイベントを会話の流れとして残す)
  message_type text not null,

  -- 本文(テキスト / Flex JSON は暗号化)
  encrypted_content text,
  attachment_storage_path text,  -- 添付の Storage パス(平文、path に org_id を含む)

  -- LINE WORKS 側メタ。inbound は冪等性のため保持(取得できる場合)
  lineworks_message_id text,

  -- 送信ステータス(direction='outbound' のみ)
  send_status text check (send_status in ('queued', 'sent', 'failed')),
  send_method text check (send_method in ('user', 'channel')),
  send_error text,

  created_at timestamptz not null default now()
);

comment on table public.lineworks_messages is
  'LINE WORKS 経由の送受信メッセージ。テキスト/Flex は encrypted_content、添付は Storage。';

create index if not exists idx_lineworks_messages_org_user_created
  on public.lineworks_messages (organization_id, lineworks_user_id, created_at desc);

-- 冪等性: lineworks_message_id がある受信は 2 度取り込まない(NULL は対象外の部分 UNIQUE)
create unique index if not exists uq_lineworks_messages_msgid
  on public.lineworks_messages (organization_id, lineworks_message_id)
  where lineworks_message_id is not null;


-- ============================================
-- 4. meeting_external_syncs (面談 ↔ 外部カレンダー 同期台帳)
--
--    既存の外部カレンダー同期は集約されておらず、Zoom 予約時に作られる Google
--    Calendar イベントの ID すら保存されていなかった(fire-and-forget)。本テーブルで
--    「面談 × 同期先」ごとの外部イベント ID を一元管理し、更新/削除を可能にする。
-- ============================================
create table if not exists public.meeting_external_syncs (
  id uuid primary key default gen_random_uuid(),
  meeting_schedule_id uuid not null
    references public.meeting_schedules(id) on delete cascade,
  -- RLS を単純にするため organization_id を非正規化保持(meeting_schedules から転記)
  organization_id uuid
    references public.organizations(id) on delete cascade,

  target text not null check (target in ('google_calendar', 'lineworks_calendar')),

  -- 各カレンダー側のイベント識別
  external_event_id text,
  external_calendar_id text,  -- LINE WORKS の organizerCalendarId(更新/削除に必要)

  sync_status text not null default 'synced'
    check (sync_status in ('synced', 'failed', 'deleted')),
  last_synced_at timestamptz,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 1 面談 × 1 同期先 で 1 行
  unique (meeting_schedule_id, target)
);

comment on table public.meeting_external_syncs is
  '面談スケジュールと外部カレンダー(Google / LINE WORKS)の同期状態・外部イベントID台帳。';


-- ============================================
-- 5. updated_at 自動更新トリガー
-- ============================================
create or replace function public.lineworks_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lineworks_channels_updated_at on public.lineworks_channels;
create trigger trg_lineworks_channels_updated_at
  before update on public.lineworks_channels
  for each row execute function public.lineworks_set_updated_at();

drop trigger if exists trg_lineworks_user_links_updated_at on public.lineworks_user_links;
create trigger trg_lineworks_user_links_updated_at
  before update on public.lineworks_user_links
  for each row execute function public.lineworks_set_updated_at();

drop trigger if exists trg_meeting_external_syncs_updated_at on public.meeting_external_syncs;
create trigger trg_meeting_external_syncs_updated_at
  before update on public.meeting_external_syncs
  for each row execute function public.lineworks_set_updated_at();


-- ============================================
-- 6. RLS(既存 LINE と同一流儀:SELECT は同 org、書込は service_role のみ)
-- ============================================
alter table public.lineworks_channels enable row level security;
alter table public.lineworks_user_links enable row level security;
alter table public.lineworks_messages enable row level security;
alter table public.meeting_external_syncs enable row level security;

drop policy if exists lwc_select on public.lineworks_channels;
create policy lwc_select on public.lineworks_channels for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists lwul_select on public.lineworks_user_links;
create policy lwul_select on public.lineworks_user_links for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists lwm_select on public.lineworks_messages;
create policy lwm_select on public.lineworks_messages for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists mes_select on public.meeting_external_syncs;
create policy mes_select on public.meeting_external_syncs for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は全て service_role 経由のみ(authenticated からの直接書込は暗黙拒否)
