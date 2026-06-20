-- ============================================
-- LINE 会話 ノート (line_conversation_notes)
--
-- 役割:
--   ・各 友達 (line_user_id) に 紐づく 内部メモ (相手 には 見えない)
--   ・本文 は AES-256-GCM 暗号化
--   ・複数件 持てる (タイムライン的 に 並べる)
--
-- 用途:
--   ・引き継ぎ メモ、 対応 履歴、 注意事項 等
-- ============================================

create table if not exists public.line_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  line_user_id text not null,

  -- 内部メモ (機密 = 暗号化)
  encrypted_content text not null,

  -- 作成者
  created_by_user_id uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.line_conversation_notes is
  '個別 LINE 友達 ごと の 内部メモ (引き継ぎ / 注意事項)。 暗号化 保存。';

create index if not exists idx_line_conv_notes_org_user
  on public.line_conversation_notes (organization_id, line_user_id, created_at desc);

-- 更新時 トリガー
create or replace function public.line_conversation_notes_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_line_conv_notes_updated_at on public.line_conversation_notes;
create trigger trg_line_conv_notes_updated_at
  before update on public.line_conversation_notes
  for each row execute function public.line_conversation_notes_set_updated_at();

-- RLS
alter table public.line_conversation_notes enable row level security;

drop policy if exists lcn_select on public.line_conversation_notes;
create policy lcn_select on public.line_conversation_notes for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は service_role 経由のみ (API ハンドラ で 認可)
