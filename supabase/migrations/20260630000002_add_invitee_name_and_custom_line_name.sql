-- ============================================
-- 2 列 追加:
--   1. meeting_schedules.invitee_name
--      → カレンダー / ICS / 一覧 で 「誰 と の 面談 か」 を 表示 する ため。
--        client_records 連携 が ない 友達 (= line_user_links 経由 の 提案)
--        で も LINE プロフィール名 を 保存 する。
--   2. line_user_links.custom_name
--      → エージェント が LINE 友達 の 表示名 を 上書き できる ように する。
--        LINE プロフィール 再取得 (auto refresh) で 上書き されない、
--        永続的 な カスタム 名 として 使う。
-- ============================================

alter table public.meeting_schedules
  add column if not exists invitee_name text;

comment on column public.meeting_schedules.invitee_name is
  '招待者 (主に LINE 友達) の 表示名。 client_records 連携 が ない 場合 の '
  'カレンダー 表示 / ICS DESCRIPTION 等 で 使用。';

alter table public.line_user_links
  add column if not exists custom_name text;

comment on column public.line_user_links.custom_name is
  'エージェント が 編集 した カスタム 表示名。 LINE プロフィール再取得 で '
  '上書き されない 永続 値。 NULL なら display_name (LINE プロフィール名) を 使う。';
