-- ============================================
-- LINE 会話 タグ (line_conversation_tags + assignments)
--
-- 役割:
--   ・組織内 で 自由に タグ を 定義 (例: 「VIP」「面談予約済」「ハイクラス」)
--   ・各 友達 (line_user_id) に 0..N 個 の タグ を 付ける
--   ・一斉配信 の ターゲット 絞込 や、 トーク 一覧 の フィルタ に 使用
--
-- タグ 自体 は 平文 (= 業務分類、 機密 とは みなさない)。
-- ============================================

create table if not exists public.line_conversation_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  name text not null,
  -- 表示用 色 (#RRGGBB)。 NULL = グレー
  color text,

  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

comment on table public.line_conversation_tags is
  '組織 ごと の LINE 会話 タグ 定義。 友達 に 紐付けて 分類 する。';

create index if not exists idx_line_conv_tags_org
  on public.line_conversation_tags (organization_id);


-- 紐付け テーブル
create table if not exists public.line_conversation_tag_assignments (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  line_user_id text not null,
  tag_id uuid not null
    references public.line_conversation_tags(id) on delete cascade,

  assigned_at timestamptz not null default now(),
  assigned_by_user_id uuid references auth.users(id) on delete set null,

  primary key (organization_id, line_user_id, tag_id)
);

comment on table public.line_conversation_tag_assignments is
  'line_user_id ↔ タグ の 多対多 紐付け。';

create index if not exists idx_line_conv_tag_assignments_tag
  on public.line_conversation_tag_assignments (tag_id);


-- RLS
alter table public.line_conversation_tags enable row level security;
alter table public.line_conversation_tag_assignments enable row level security;

drop policy if exists lct_select on public.line_conversation_tags;
create policy lct_select on public.line_conversation_tags for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists lcta_select on public.line_conversation_tag_assignments;
create policy lcta_select on public.line_conversation_tag_assignments for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は service_role 経由 のみ (API で 認可)
