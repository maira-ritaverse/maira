-- =====================================================================
-- 監査 H3/H4/M5 対応: 未認証 公開 エンドポイント の レート 制限 用 永続 テーブル
--
-- Vercel サーバーレス は 並列 度 が 上がる と 新規 lambda が スケール アウト し、
-- モジュール スコープ の Map で 保持 する in-memory バケット が 全て 「初回」
-- として 判定 され、 事実上 レート 制限 が バイパス される。
-- Supabase テーブル に イベント を 記録 して sliding window で 判定 する ことで、
-- lambda 間 で 状態 を 共有 する。
--
-- 対象:
--   H3: requestPasswordReset (IP × email)
--   H4: /api/marketing/lead-request, /api/marketing/roi-simulation
--   M5: /api/contact
-- =====================================================================

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  bucket_key text not null,
  occurred_at timestamptz not null default now()
);

-- bucket_key + occurred_at の 複合 index で sliding window の count() を 高速化
create index if not exists idx_rate_limit_events_bucket_time
  on public.rate_limit_events (bucket_key, occurred_at desc);

-- 24 時間 以上 経過 した レコード の 自動 掃除 用 index
create index if not exists idx_rate_limit_events_occurred_at
  on public.rate_limit_events (occurred_at);

-- service_role からの 書き込み のみ 許可 (公開 endpoint から の 直接 書き込み は 不要)
alter table public.rate_limit_events enable row level security;

drop policy if exists rle_service_all on public.rate_limit_events;
create policy rle_service_all on public.rate_limit_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.rate_limit_events is
  'H3/H4/M5 対策 の 未認証 公開 endpoint 用 レート 制限 イベント テーブル。 sliding window で 判定。';
comment on column public.rate_limit_events.bucket_key is
  'namespace:identifier 形式 の キー (例 pw_reset:ip:1.2.3.4, marketing_lead:email:hash)。';

-- ============================================
-- レート チェック RPC
--
-- 呼び 出し 側 が (bucket_key, window_seconds, max_count) を 渡す と、
-- 現在 の 窓 内 の count を 返し、 上限 未満 なら 新規 行 を INSERT して true を 返す。
-- 上限 に 達して いる 場合 は false を 返し、 INSERT しない。
-- 24 時間 以上 前 の 行 は 序 で に 削除 (機会 主義 的 な GC)。
-- ============================================
create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_window_seconds int,
  p_max_count int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  -- 序 で GC (24h 以上 前 の 行 を 削除)。 頻繁 に は 走らない よう に count に 応じて 実行。
  if random() < 0.02 then
    delete from public.rate_limit_events
     where occurred_at < now() - interval '24 hours';
  end if;

  select count(*)
    into v_count
    from public.rate_limit_events
   where bucket_key = p_bucket_key
     and occurred_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max_count then
    return false;
  end if;

  insert into public.rate_limit_events (bucket_key) values (p_bucket_key);
  return true;
end;
$$;

comment on function public.consume_rate_limit(text, int, int) is
  'sliding window レート 制限 の check-and-consume。 上限 未満 なら INSERT + true、 上限 なら false。';
