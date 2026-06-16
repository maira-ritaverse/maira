-- ============================================================================
-- calendar_feed_tokens:Maira → 任意のカレンダーアプリへの「公開購読 URL」
--
-- 用途:
--   ・ユーザが Google Calendar / Apple Calendar / Outlook 等で
--     「URL から他のカレンダーを追加」して Maira の予定を購読できる
--   ・トークンは URL に含まれる秘密値(知っている人は見られる)。
--     何かあれば再発行(古いトークンを無効化)できる前提。
--
-- セキュリティ方針:
--   ・トークンは crypto.randomBytes(32) base64url 想定(48 文字)
--   ・user_id × 1 行(複数発行は許さない。再発行で UPSERT)
--   ・有効期限は設けず、ユーザ操作で「再発行」or「無効化」
--   ・revoked_at が NOT NULL なら無効。配信エンドポイントで弾く
--
-- 注意:
--   ・本テーブル自体は機微情報を持たない(配信内容は別テーブルから動的生成)
--   ・トークン文字列自体は機密相当なので、エージェントは「自分のトークン」を
--     ダッシュボードで見られる、運営者は閲覧しないルールで運用
-- ============================================================================

create table if not exists public.calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  token text not null unique,
  revoked_at timestamptz,
  -- 簡易アクセスログ(最終取得時刻のみ。アクセス回数や IP は持たない)
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cft_token on public.calendar_feed_tokens (token);

drop trigger if exists set_cft_updated_at on public.calendar_feed_tokens;
create trigger set_cft_updated_at
  before update on public.calendar_feed_tokens
  for each row execute function public.set_updated_at();

alter table public.calendar_feed_tokens enable row level security;

-- 本人のみ自分の行を SELECT / DELETE できる(発行 / 失効に使う)
-- INSERT / UPDATE は API ルートが service_role 経由で行う
--   (UPSERT のロジックは API 側、RLS は読み取りだけに絞る)
drop policy if exists "Self can view feed token" on public.calendar_feed_tokens;
create policy "Self can view feed token"
  on public.calendar_feed_tokens for select
  using (user_id = auth.uid());

drop policy if exists "Self can delete feed token" on public.calendar_feed_tokens;
create policy "Self can delete feed token"
  on public.calendar_feed_tokens for delete
  using (user_id = auth.uid());

comment on table public.calendar_feed_tokens is
  'Maira 予定を外部カレンダーへ公開購読させるためのトークン(.ics フィード用)';
