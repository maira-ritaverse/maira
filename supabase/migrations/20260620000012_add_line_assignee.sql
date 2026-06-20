-- ============================================
-- LINE 会話 担当者 (line_user_links.assigned_to_user_id)
--
-- 役割:
--   ・各 友達 に 「担当 エージェント」 を 設定
--   ・対応 漏れ 防止 + 引継ぎ 用
--   ・通知 で 「担当 のみ 通知」 等 後日 拡張 余地
-- ============================================

alter table public.line_user_links
  add column if not exists assigned_to_user_id uuid
    references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by_user_id uuid
    references auth.users(id) on delete set null;

comment on column public.line_user_links.assigned_to_user_id is
  '担当 エージェント (organization_member の user_id)。 NULL = 未割当。';

create index if not exists idx_line_user_links_assignee
  on public.line_user_links (organization_id, assigned_to_user_id)
  where assigned_to_user_id is not null;
