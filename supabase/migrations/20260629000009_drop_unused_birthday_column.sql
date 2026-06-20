-- ============================================
-- client_records.birthday 列 を 削除
--
-- 経緯:
--   20260629000008 で birthday_greeting シナリオ 用 に birthday 列 を
--   追加 した が、 EMPRO 拡張 (20260615100001) で 既 に birth_date 列 が
--   存在 する こと が 判明 (= 重複)。
--
-- birth_date を そのまま 流用 する 方針 に 変更 した ため、 今回 追加 した
-- birthday 列 と 関連 index を 撤去。
-- ============================================

drop index if exists public.idx_client_records_birthday_mmdd;
alter table public.client_records
  drop column if exists birthday;
