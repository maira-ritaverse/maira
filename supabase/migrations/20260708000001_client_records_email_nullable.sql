-- =====================================================================
-- client_records.email を nullable に する
--
-- 目的:
--   ・LINE 友達 から の CRM 追加 で、 会話 に email が 出て こない 場合 に
--     ダミー email (`line_XXX@line.local`) を 保存 する 運用 が
--     見苦しく、 dedup / 一斉 メール で 事故 の 元 に なる。
--   ・実際 の email が 判明 する まで NULL で 保持 し、 admin が 後で
--     入力 する 運用 に する。
--
-- 影響:
--   ・下流 の bulk-email / send-email / invite は email IS NULL の 場合 に
--     エラー を 返す ように 別途 修正 する。
--   ・dedup は email IS NULL を キー から 除外 する。
-- =====================================================================

alter table public.client_records
  alter column email drop not null;

comment on column public.client_records.email is
  '連絡 用 email。 LINE 友達 由来 で 会話 に email が 無い 場合 は NULL。 後で admin が 補完 する 運用。';
