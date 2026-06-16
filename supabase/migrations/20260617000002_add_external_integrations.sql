-- =====================================================================
-- 外部連携(Zoom Cloud Recording / Google Meet via Drive)接続情報
--
-- 目的:
--   ・「会議録音 自動連携」アドオン用に各サービスの OAuth トークンを保管
--   ・access_token / refresh_token は AES-256-GCM で暗号化保存(v{n}: 形式)
--   ・1 ユーザ × 1 プロバイダ = 1 行(unique 制約)
--
-- セキュリティ:
--   ・RLS は本人 SELECT/DELETE のみ(切断操作だけクライアントから許可)
--   ・INSERT/UPDATE はサーバ側(API route)で service_role を使用しない代わりに
--     auth.uid() = user_id ポリシーでクライアント文脈の書込を許す
--     (OAuth callback ルートでログイン済ユーザに紐付けて upsert するため)
-- =====================================================================

create table if not exists public.zoom_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- Zoom 側のユーザ識別(将来 webhook で payload.account_id / payload.user_id 突合に使う)
  zoom_user_id text,
  zoom_account_id text,
  -- 暗号化保存(lib/crypto/field-encryption の v{n}: 形式)
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  -- 付随情報
  scope text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zoom_connections_zoom_user_idx
  on public.zoom_connections (zoom_user_id);

alter table public.zoom_connections enable row level security;

drop policy if exists zoom_connections_self_rw on public.zoom_connections;
create policy zoom_connections_self_rw
  on public.zoom_connections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.zoom_connections is
  'Zoom OAuth 接続情報。access/refresh トークンは AES-256-GCM 暗号化';

-- ───────────────────────────────────────────────────────────────────
-- Google(Meet / Drive)接続
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- Google アカウント識別(sub / email)
  google_sub text,
  google_email text,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  scope text,
  token_expires_at timestamptz,
  -- Meet 録画の検出に使う Drive ファイル ID の最後の polling 位置
  last_drive_poll_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_connections_sub_idx
  on public.google_connections (google_sub);

alter table public.google_connections enable row level security;

drop policy if exists google_connections_self_rw on public.google_connections;
create policy google_connections_self_rw
  on public.google_connections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.google_connections is
  'Google OAuth 接続情報。Meet 録画 → Drive 経由の自動取込に使用';

-- ───────────────────────────────────────────────────────────────────
-- updated_at トリガ(2 テーブル共通)
-- ───────────────────────────────────────────────────────────────────
create or replace function public.touch_integration_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists zoom_connections_touch_trg on public.zoom_connections;
create trigger zoom_connections_touch_trg
  before update on public.zoom_connections
  for each row execute function public.touch_integration_updated_at();

drop trigger if exists google_connections_touch_trg on public.google_connections;
create trigger google_connections_touch_trg
  before update on public.google_connections
  for each row execute function public.touch_integration_updated_at();
