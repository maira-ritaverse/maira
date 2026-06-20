-- ============================================
-- LINE 公式アカウント 連携 (Phase 1: DB スキーマ)
--
-- 仕様: docs/line-integration-design.md
--
-- 構成テーブル:
--   ・line_channels       — org ごとの LINE Channel 設定 (Token 暗号化)
--   ・line_user_links     — LINE userId ↔ client_records の 紐付け
--   ・line_link_codes     — 求職者側で 入力する 6 桁 連携コード
--   ・line_messages       — 送受信メッセージ (encrypted_content)
--
-- ENUM:
--   ・line_message_direction (inbound / outbound)
--   ・line_message_type (text / sticker / image / video / audio / file / location / flex / template / system)
--
-- 書き込み方針:
--   ・SELECT は 同 org メンバー
--   ・INSERT / UPDATE / DELETE は service_role 経由のみ (API ハンドラで 認可)
--   ・line_link_codes の consume は webhook 経由で service_role 直接
--
-- 既存テーブル との 関係:
--   ・organizations.id を 外部キー
--   ・client_records.id を 外部キー (紐付け先 = 求職者プロファイル)
--   ・job_postings.id を 関連付け (求人共有 メッセージ)
--   ・meeting_schedules.id を 関連付け (Zoom 日程 メッセージ、 Phase 3)
-- ============================================


-- ============================================
-- 1. ENUM 型
-- ============================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'line_message_direction') then
    create type public.line_message_direction as enum ('inbound', 'outbound');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'line_message_type') then
    create type public.line_message_type as enum (
      'text', 'sticker', 'image', 'video', 'audio', 'file', 'location',
      'flex', 'template',
      -- system = LINE 側 イベント (follow / unfollow / postback 等) を 「会話の流れ」
      -- として 残す ため。 例:「友達追加 されました」「ブロック されました」
      'system'
    );
  end if;
end$$;


-- ============================================
-- 2. line_channels (org ごとの LINE 設定)
-- ============================================
create table if not exists public.line_channels (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,

  -- LINE Developers コンソール から 取得 (公開情報)
  line_channel_id text not null unique,
  line_bot_user_id text,  -- @xxxxx の Bot 自体の userId (verify 時に 取得)

  -- 機密 (lib/crypto/field-encryption の v{n}: 形式 で 暗号化)
  line_channel_secret_encrypted text not null,
  line_channel_access_token_encrypted text not null,

  -- Webhook URL に 含める トークン (推測困難な 32 文字 ランダム)
  -- LINE → Maira への 入口 URL: /api/webhooks/line/{webhook_token}
  webhook_token text not null unique,

  -- LIFF (Phase 4 で 使用)
  liff_id text,

  -- LINE 側 課金プラン (参考表示、 Maira では 課金しない)
  line_plan text check (line_plan in ('free', 'light', 'standard')),
  monthly_message_quota int check (monthly_message_quota >= 0),

  -- 状態
  is_active boolean not null default true,
  last_verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.line_channels is
  'エージェント企業の LINE 公式アカウント 連携設定。1 org 1 row。';
comment on column public.line_channels.line_channel_secret_encrypted is
  'LINE Channel Secret (HMAC-SHA256 検証用)。 v{n}: 形式 で 暗号化。';
comment on column public.line_channels.line_channel_access_token_encrypted is
  'LINE Channel Access Token (長期)。 メッセージ送信に 使用。 v{n}: 形式 で 暗号化。';
comment on column public.line_channels.webhook_token is
  'Webhook URL に 含める ランダムトークン。 漏洩時は ローテーション。';


-- ============================================
-- 3. line_user_links (LINE userId ↔ client_records)
-- ============================================
create table if not exists public.line_user_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- LINE userId (U + 32 hex 桁、 公開情報なので 平文)
  line_user_id text not null,

  -- 紐付け先 client_record (NULL = 未紐付け 友達)
  client_record_id uuid references public.client_records(id) on delete set null,

  -- LINE プロフィール (Bot 経由で 取得、 平文で OK)
  display_name text,
  picture_url text,
  status_message text,

  -- 紐付け メタ
  linked_at timestamptz,
  link_method text check (link_method in ('manual', 'code', 'liff_login')),

  -- ブロック / 友達解除
  unfollowed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, line_user_id)
);

comment on table public.line_user_links is
  'LINE Bot の 友達 + client_records への 紐付け 状態。 1 org × 1 lineUserId で unique。';

create index if not exists idx_line_user_links_client_record
  on public.line_user_links (client_record_id)
  where client_record_id is not null;

create index if not exists idx_line_user_links_org_unlinked
  on public.line_user_links (organization_id)
  where client_record_id is null and unfollowed_at is null;


-- ============================================
-- 4. line_link_codes (求職者側 連携コード)
-- ============================================
create table if not exists public.line_link_codes (
  code text primary key,  -- 6 桁 数字 + 大文字 (例: 'A3F9K2')
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  client_record_id uuid not null
    references public.client_records(id) on delete cascade,

  expires_at timestamptz not null,  -- 24 時間有効

  -- 使用済み (LINE で コード 送信 → webhook で マッチング)
  consumed_by_line_user_id text,
  consumed_at timestamptz,

  -- 発行者 (エージェント側、 失効処理 / 監査 用)
  issued_by_user_id uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.line_link_codes is
  'エージェントが client_record 用 に 発行する 連携コード。 求職者が LINE で 送信 → 自動紐付け。';

create index if not exists idx_line_link_codes_org_active
  on public.line_link_codes (organization_id, expires_at)
  where consumed_at is null;


-- ============================================
-- 5. line_messages (送受信メッセージ)
-- ============================================
create table if not exists public.line_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- 相手 LINE userId (常に 求職者側、 直接 line_user_links に join 可能)
  line_user_id text not null,
  client_record_id uuid references public.client_records(id) on delete set null,

  direction public.line_message_direction not null,
  message_type public.line_message_type not null,

  -- 内容 (テキスト / Flex JSON は 暗号化)
  encrypted_content text,
  attachment_storage_path text,  -- 画像 / ファイル の Storage パス (平文、 path 自体に org_id 含む)
  sticker_package_id text,
  sticker_id text,

  -- LINE 側 メタ
  line_message_id text,  -- 受信メッセージ の LINE 側 ID (冪等性 確保 用)
  reply_token text,
  reply_token_expires_at timestamptz,

  -- 送信ステータス (direction='outbound' のみ)
  send_status text check (send_status in ('queued', 'sent', 'failed')),
  send_method text check (send_method in ('reply', 'push', 'multicast')),
  send_error text,

  -- 既読 (LIFF 経由 のみ 取得可能、 通常 LINE は 既読不明)
  read_at timestamptz,

  -- 関連 (Flex 求人 / Zoom 案内 の 追跡 用)
  related_job_id uuid references public.job_postings(id) on delete set null,
  related_meeting_schedule_id uuid references public.meeting_schedules(id) on delete set null,

  created_at timestamptz not null default now(),

  -- 冪等性: 同じ line_message_id を 2 度 INSERT させない
  unique (organization_id, line_message_id)
);

comment on table public.line_messages is
  'LINE 経由の 送受信メッセージ。 テキスト / Flex は encrypted_content、 添付は Storage。';

create index if not exists idx_line_messages_org_user_created
  on public.line_messages (organization_id, line_user_id, created_at desc);

create index if not exists idx_line_messages_inbound_unprocessed
  on public.line_messages (organization_id, created_at desc)
  where direction = 'inbound' and read_at is null;


-- ============================================
-- 6. updated_at 自動更新 トリガー (line_channels / line_user_links)
-- ============================================
create or replace function public.line_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_line_channels_updated_at on public.line_channels;
create trigger trg_line_channels_updated_at
  before update on public.line_channels
  for each row execute function public.line_set_updated_at();

drop trigger if exists trg_line_user_links_updated_at on public.line_user_links;
create trigger trg_line_user_links_updated_at
  before update on public.line_user_links
  for each row execute function public.line_set_updated_at();


-- ============================================
-- 7. RLS
-- ============================================
alter table public.line_channels enable row level security;
alter table public.line_user_links enable row level security;
alter table public.line_link_codes enable row level security;
alter table public.line_messages enable row level security;

-- SELECT: 同 org メンバー (admin / advisor とも 閲覧可)
drop policy if exists lc_select on public.line_channels;
create policy lc_select on public.line_channels for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists lul_select on public.line_user_links;
create policy lul_select on public.line_user_links for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists llc_select on public.line_link_codes;
create policy llc_select on public.line_link_codes for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists lm_select on public.line_messages;
create policy lm_select on public.line_messages for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は 全て service_role 経由のみ。
-- (authenticated ユーザーから 直接書込は 暗黙拒否)


-- ============================================
-- 8. RPC: 連携コード 発行 (admin / advisor とも 可)
--
--    1 client_record に 同時に 複数 アクティブ コード を 持たない (古いものは 失効)。
--    返り値:6 桁 コード (英大文字 + 数字)
-- ============================================
create or replace function public.issue_line_link_code(
  p_client_record_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 紛らわしい O / I / 0 / 1 除外
  v_attempts int := 0;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  -- client_record が 自組織のものか 確認
  if not exists (
    select 1 from public.client_records
    where id = p_client_record_id and organization_id = v_caller_org_id
  ) then
    raise exception 'client_not_found' using errcode = 'P0001';
  end if;

  -- 既存の 未消費コードを 即時 失効
  update public.line_link_codes
  set expires_at = now()
  where client_record_id = p_client_record_id
    and consumed_at is null
    and expires_at > now();

  -- 衝突しない 6 桁コードを 生成 (最大 10 回 リトライ)
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;

    begin
      insert into public.line_link_codes (
        code, organization_id, client_record_id,
        expires_at, issued_by_user_id
      ) values (
        v_code, v_caller_org_id, p_client_record_id,
        now() + interval '24 hours', v_caller_user_id
      );
      return v_code;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts >= 10 then
        raise exception 'code_generation_failed' using errcode = 'P0001';
      end if;
    end;
  end loop;
end;
$$;

comment on function public.issue_line_link_code(uuid) is
  'admin / advisor が client_record 用の 6 桁 連携コードを 発行 (24 時間有効)。';


-- ============================================
-- 9. RPC: 連携コード 消費 (webhook 経由、 service_role 限定)
--
--    LINE で コード を 受信 → このRPC で 紐付け 確定。
--    auth.role()='service_role' を 要求 (普通の authenticated からは 不可)。
-- ============================================
create or replace function public.consume_line_link_code(
  p_code text,
  p_line_user_id text,
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_code public.line_link_codes;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  -- コード を ロック付き で 取得
  select * into v_link_code
  from public.line_link_codes
  where code = p_code
    and organization_id = p_organization_id
  for update;

  if v_link_code.code is null then
    raise exception 'code_not_found' using errcode = 'P0001';
  end if;
  if v_link_code.consumed_at is not null then
    raise exception 'code_already_consumed' using errcode = 'P0001';
  end if;
  if v_link_code.expires_at < v_now then
    raise exception 'code_expired' using errcode = 'P0001';
  end if;

  -- コード 消費
  update public.line_link_codes
  set consumed_at = v_now,
      consumed_by_line_user_id = p_line_user_id
  where code = p_code;

  -- line_user_links を upsert (既存 友達 行 が あれば client_record_id を セット、
  --                             無ければ 新規 INSERT)
  insert into public.line_user_links (
    organization_id, line_user_id, client_record_id,
    linked_at, link_method
  ) values (
    p_organization_id, p_line_user_id, v_link_code.client_record_id,
    v_now, 'code'
  )
  on conflict (organization_id, line_user_id) do update set
    client_record_id = v_link_code.client_record_id,
    linked_at = v_now,
    link_method = 'code',
    updated_at = v_now;

  return v_link_code.client_record_id;
end;
$$;

comment on function public.consume_line_link_code(text, text, uuid) is
  '求職者が LINE で 送信した コード を 消費し、 line_user_id を client_record に 紐付ける (webhook 用)。';
