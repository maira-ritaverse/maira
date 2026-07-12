-- ============================================
-- Fix: 一括割当 RPC の GRANT EXECUTE 忘れを修正
--
-- 20260709000015_bulk_team_assign_rpcs.sql で作成した
-- assign_clients_to_teams_bulk / unassign_clients_from_teams_bulk は
-- SECURITY DEFINER で作成されていたが、authenticated ロールへの
-- GRANT EXECUTE が抜けていた。
--
-- 症状:
--   ・「リスト表に追加」/「リスト表から外す」の一括操作 API が
--     Postgres 42501 (permission denied for function ...) を返す
--   ・route 側で 42501 は "forbidden" にマップされるので、UI では
--     「一括操作に失敗: リスト表への一括操作の権限がありません」と表示される
--   ・実際は管理者/主担当/リーダーで あっても 発生する(権限判定に到達する前で
--     関数呼び出し自体が弾かれるため)
--
-- 修正:
--   authenticated ロールに EXECUTE 権限を付与。 関数内部の権限判定は
--   SECURITY DEFINER + 引数を見る PL/pgSQL ロジックで別途行われるので、
--   ここで EXECUTE を許可しても DB 内の判定は変わらない。
-- ============================================

grant execute on function public.assign_clients_to_teams_bulk(uuid[], uuid[])
  to authenticated;

grant execute on function public.unassign_clients_from_teams_bulk(uuid[], uuid[])
  to authenticated;
