-- ============================================
-- LINE 会話 対応状況 (line_user_links 拡張)
--
-- 概念:
--   ・要対応 (handled_at IS NULL) — 新着 inbound メッセージ あり、 まだ 返信 して いない
--   ・対応済 (handled_at IS NOT NULL) — エージェント が 返信 した or 手動 マーク
--
-- 自動 切替:
--   ・inbound メッセージ 受信 → handled_at = NULL に 戻す
--   ・outbound 送信 → handled_at = now()
--   ・UI から 手動 切替 も 可能
-- ============================================

alter table public.line_user_links
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by_user_id uuid references auth.users(id) on delete set null;

comment on column public.line_user_links.handled_at is
  '対応済 マーク 時刻 (NULL = 要対応)。 inbound で NULL、 outbound で now() に 自動切替。';

create index if not exists idx_line_user_links_handled
  on public.line_user_links (organization_id, handled_at)
  where unfollowed_at is null;
