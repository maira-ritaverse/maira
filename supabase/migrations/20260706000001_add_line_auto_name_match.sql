-- =====================================================================
-- line_user_links.link_method CHECK 制約 に 'auto_name_match' を 追加
--
-- 目的: LINE 友達 追加 時 に、 display_name が CRM 顧客名 と 完全 一致 する 場合
--       に 自動 で 紐付け る 機能 を 導入 する。 監査 目的 で リンク 元 を
--       link_method で 区別 する。
--
-- 既存 値: 'manual' | 'code' | 'liff_login'
-- 追加 値: 'auto_name_match'
-- =====================================================================

alter table public.line_user_links
  drop constraint if exists line_user_links_link_method_check;

alter table public.line_user_links
  add constraint line_user_links_link_method_check
  check (link_method in ('manual', 'code', 'liff_login', 'auto_name_match'));
