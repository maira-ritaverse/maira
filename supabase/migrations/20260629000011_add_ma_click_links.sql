-- ============================================
-- MA クリック 計測
--
-- 配信 メッセージ 本文 の URL を 短縮 URL (= ma_click_links.id を 含む
-- https://www.maira.pro/r/{uuid}) に 置換 し、 受信者 が クリック した 際
-- に そこ を 経由 して 元 URL へ 301 redirect する。 経由 時 に
-- click_count を ++ する シンプル 方式。
--
-- 設計:
--   ・1 link = 1 (organization, send_log, original_url) の 3 つ 組
--     同一 配信 内 で 同じ URL が 複数回 出て も link は 1 つ で OK
--   ・cron / 配信 経路 から service_role で INSERT する
--   ・redirect エンドポイント は 認証 不要 (公開 short URL)
--   ・bot prefetch の click 過剰 計上 は 受け入れる (LINE クライアント の
--     preview 含む。 完璧 な 計測 は スコープ 外)
-- ============================================

create table if not exists public.ma_click_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  send_log_id uuid
    references public.ma_send_logs(id) on delete cascade,

  original_url text not null,

  click_count int not null default 0,
  last_clicked_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.ma_click_links is
  'MA 配信 メッセージ 内 URL の 短縮 マッパー + クリック 計測。';

create index if not exists idx_ma_click_links_org_created
  on public.ma_click_links (organization_id, created_at desc);
create index if not exists idx_ma_click_links_send_log
  on public.ma_click_links (send_log_id);
create index if not exists idx_ma_click_links_clicked
  on public.ma_click_links (organization_id, last_clicked_at desc)
  where click_count > 0;

-- RLS
alter table public.ma_click_links enable row level security;

-- SELECT: 同 org メンバー (KPI 集計 / 詳細 表示)
drop policy if exists mcl_select on public.ma_click_links;
create policy mcl_select on public.ma_click_links for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は service_role 経由 のみ (cron / redirect API)
