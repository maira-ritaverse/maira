-- =====================================================================
-- 防御: 新 / 既存 の メンバー / アバター 関連 RPC に 明示 的 な
-- grant execute to authenticated を 追加
--
-- 経緯:
--   20260630000006 で list_organization_members_with_meta を drop → 再 create
--   した 際 に、 元 migration (20260602000005) に も grant 文 が なく、
--   PostgreSQL の PUBLIC EXECUTE デフォルト で 暗黙 的 に 動いて いた。
--   Supabase 環境 で は authenticated は public schema の function を 呼べる
--   設定 だ が、 将来 ハーデニング で 動か なく なる リスク を 排除 する ため
--   明示 grant を 入れて おく。
-- =====================================================================

grant execute on function public.list_organization_members_with_meta(uuid)
  to authenticated;

-- 既存 の display name 専用 RPC も 念のため 明示 化
grant execute on function public.list_organization_member_display_names(uuid)
  to authenticated;
