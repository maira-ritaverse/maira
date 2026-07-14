-- ============================================
-- レポート:ユーザーごとの表示設定
--
-- 目的:
--   ・レポート画面のセクション並び順と非表示指定を、ユーザーごとに保存する。
--   ・企業ごとにも「見たい指標」が違うため、ユーザーが自分のビューを
--     組み立てられるようにする(admin が全体に強制する形にはしない)。
--
-- スキーマ:
--   ・(user_id, organization_id) で unique
--   ・section_order:jsonb 配列(セクション ID の順序。 空配列ならデフォルト順)
--   ・hidden_sections:jsonb 配列(非表示にした ID)
--   ・未知の ID / 欠けた ID は UI 側で吸収するため、DB では check しない
--     (アプリ側でセクション定義が変わっても安全に扱える)
--
-- セキュリティ:
--   ・SELECT / INSERT / UPDATE / DELETE すべて「自分の行のみ」
--   ・組織を跨いだ読み書きは不可(RLS で user_id = auth.uid())
-- ============================================

create table if not exists public.report_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- セクション ID の配列(表示したい順)。 空配列ならデフォルト順
  section_order jsonb not null default '[]'::jsonb,
  -- 非表示にした ID の配列
  hidden_sections jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (user_id, organization_id)
);

comment on table public.report_preferences is
  'レポート画面のユーザー別カスタマイズ設定(並び順・非表示)';

create index if not exists idx_report_preferences_user_org
  on public.report_preferences (user_id, organization_id);

alter table public.report_preferences enable row level security;

-- 自分の行だけ読める(auth.uid() = user_id)
create policy "report_preferences_select_self"
  on public.report_preferences for select
  using (user_id = auth.uid());

-- 自分の行だけ作れる。 organization_id は自分の所属組織のみ
create policy "report_preferences_insert_self"
  on public.report_preferences for insert
  with check (
    user_id = auth.uid()
    and organization_id = public.current_user_organization_id()
  );

-- 自分の行だけ更新できる
create policy "report_preferences_update_self"
  on public.report_preferences for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and organization_id = public.current_user_organization_id()
  );

-- 自分の行だけ消せる(reset のため)
create policy "report_preferences_delete_self"
  on public.report_preferences for delete
  using (user_id = auth.uid());
