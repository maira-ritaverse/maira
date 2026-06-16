-- =====================================================================
-- 保存ビュー(saved_views)
--
-- エージェント担当者が、よく使うフィルタ条件(検索キーワード・ステータス・
-- 都道府県・雇用形態・沈黙日数 等)を名前付きで保存し、後から 1 クリックで
-- 復元できるようにするための個人ストレージ。CRM の「マイビュー」機能。
--
-- スコープ:
--   - 個人専有(user_id = auth.uid())。組織内の他メンバーには見えない。
--   - resource カラムで対象を切り替える('clients' のみ初期実装、'jobs' 等は将来)。
--   - 同一(user_id, resource, name)はユニーク(同名は上書き保存を強制)。
--
-- セキュリティ:
--   - 全 CRUD は user_id = auth.uid() に限定。
--   - organization_id は冗長保存して、組織を抜けたユーザーの旧ビューを
--     RLS でついでに除外できるようにする(将来拡張用)。
--   - filters は jsonb。サイズ制限は CHECK 制約で上限 8 KiB に縛る
--     (誤って巨大な配列を保存する事故防止)。
-- =====================================================================

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 将来 'jobs'(求人ビュー)等にも展開する余地を残す。初期は 'clients' のみ。
  resource text not null check (resource in ('clients')),
  name text not null check (length(trim(name)) > 0 and length(name) <= 100),
  -- フィルタ条件(検索文字列・ステータス・都道府県等)を JSON で保存。
  -- スキーマは lib/saved-views/types.ts に集約(DB 側は構造を強制しない)。
  filters jsonb not null check (pg_column_size(filters) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同一ユーザー × 同一リソース × 同一名 はユニーク(同名は上書き)
create unique index if not exists saved_views_user_resource_name_idx
  on public.saved_views (user_id, resource, name);

-- 一覧の並び順(更新の新しい順 → 名前)で軽くしたいので副インデックス
create index if not exists saved_views_user_resource_updated_idx
  on public.saved_views (user_id, resource, updated_at desc);

comment on table public.saved_views is 'エージェント担当者のマイビュー(保存済みフィルタ条件、CRM 機能)';
comment on column public.saved_views.user_id is 'ビューの所有者(auth.uid())';
comment on column public.saved_views.organization_id is '所属組織。冗長保存。RLS の補助';
comment on column public.saved_views.resource is '対象リソース。初期は ''clients'' のみ';
comment on column public.saved_views.filters is 'JSON 形式のフィルタ条件。スキーマは TS 側に集約';

-- ===========================
-- 更新日時の自動セット
-- ===========================
-- set_updated_at() は既存(20260520000002 で導入)。
drop trigger if exists set_saved_views_updated_at on public.saved_views;
create trigger set_saved_views_updated_at
  before update on public.saved_views
  for each row execute function public.set_updated_at();

-- ===========================
-- RLS
-- ===========================
alter table public.saved_views enable row level security;

-- SELECT:自分のビューのみ
drop policy if exists "Users can view their own saved views" on public.saved_views;
create policy "Users can view their own saved views"
  on public.saved_views for select
  using (auth.uid() = user_id);

-- INSERT:自分のビューを自組織でのみ作成可
drop policy if exists "Users can insert their own saved views" on public.saved_views;
create policy "Users can insert their own saved views"
  on public.saved_views for insert
  with check (
    auth.uid() = user_id
    and organization_id = public.current_user_organization_id()
  );

-- UPDATE:自分のビューのみ。organization_id は不変化したい(他組織への横流し防止)
drop policy if exists "Users can update their own saved views" on public.saved_views;
create policy "Users can update their own saved views"
  on public.saved_views for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and organization_id = public.current_user_organization_id()
  );

-- DELETE:自分のビューのみ
drop policy if exists "Users can delete their own saved views" on public.saved_views;
create policy "Users can delete their own saved views"
  on public.saved_views for delete
  using (auth.uid() = user_id);
