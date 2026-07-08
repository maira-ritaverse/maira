-- =====================================================================
-- 20260708000009 で 「Members can view organization clients」 という 存在 しない
-- 名前 の policy を drop しよう と して 実質 no-op に なって いた 修正。
-- 既存 の 汎用 SELECT policy を 削除 し、 team 分離 policy だけ を 残す。
-- =====================================================================

drop policy if exists "Members can view client records in their organization"
  on public.client_records;

-- 20260708000009 で 作成 済 の cr_select_team_scoped は そのまま。
