-- ============================================================================
-- 自然文検索 (求人 / クライアント) の解釈結果キャッシュ
--
-- 背景:
--   Tier 4 プロトタイプで、エージェント画面の検索欄に「年収 500 万以上でリモート
--   可の Web エンジニア」のような自然文を投げると、Claude Haiku 4.5 が構造化
--   フィルタ (JobFilters / ClientFilters) に変換する。
--   同一クエリに対する重複呼び出しを避けるため、組織単位で解釈結果を短期キャッシュする。
--
-- 設計判断:
--   ・PK は (organization_id, resource, query_hash) の複合キー。
--     query_hash は正規化 (NFKC + 小文字化 + 空白圧縮) 後の SHA-256 hex 先頭 32 文字。
--   ・TTL は expires_at カラムで管理 (24 時間)。GC は機会主義的に行う。
--   ・filters_json は AI が返した構造化フィルタをそのまま JSONB で保持する。
--   ・RLS は「所属組織のメンバーのみ read」+「service_role のみ write」に絞る
--     (公開 endpoint ではないので通常は service_role 経由で書く)。
-- ============================================================================

create table if not exists public.nl_search_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  resource text not null check (resource in ('jobs', 'clients')),
  query_hash text not null,
  query_text text not null,
  filters_json jsonb not null,
  remaining_text text not null default '',
  confidence text not null default 'high' check (confidence in ('high', 'low')),
  model text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (organization_id, resource, query_hash)
);

create index if not exists idx_nl_search_cache_expires_at
  on public.nl_search_cache (expires_at);

alter table public.nl_search_cache enable row level security;

-- 所属組織のメンバーは自分の org のキャッシュだけ read できる
-- (機能フラグ的に「自分が投げたクエリの解釈結果を他人が見ても支障ない」判断だが、
--  組織境界は最低限守る)。
drop policy if exists nsc_org_read on public.nl_search_cache;
create policy nsc_org_read on public.nl_search_cache
  for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = nl_search_cache.organization_id
        and om.user_id = auth.uid()
    )
  );

-- 書き込みは service_role のみ (API route が service key で upsert する)
drop policy if exists nsc_service_write on public.nl_search_cache;
create policy nsc_service_write on public.nl_search_cache
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.nl_search_cache is
  '自然文検索 (Tier 4) の Claude 解釈結果を組織単位でキャッシュ。TTL は expires_at で管理。';
comment on column public.nl_search_cache.query_hash is
  '正規化 (NFKC + 小文字化 + 空白圧縮) 後の SHA-256 hex 先頭 32 文字。組織 + resource で複合 PK。';
comment on column public.nl_search_cache.filters_json is
  'AI が返した構造化フィルタ (JobFilters または ClientFilters の JSON)。';
