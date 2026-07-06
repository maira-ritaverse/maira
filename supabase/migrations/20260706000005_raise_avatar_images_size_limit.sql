-- =====================================================================
-- avatar-images バケット の file_size_limit を 2 MiB → 5 MiB に 引き 上げ
--
-- 理由:
--   ・LINE 自己 紹介 の 顔 写真 は 元 画像 が 5〜6 MB に なる ケース が 多く、
--     2 MiB 上限 だと 事前 圧縮 が 必須 で UX が 悪い。
--   ・アイコン (avatar 単体) は 引き 続き 2 MiB 上限 を API 側 で 課す。
--   ・LINE 自己 紹介 は 5 MiB まで 許容 する 運用。
--
-- 変更:
--   avatar-images.file_size_limit: 2097152 (2 MiB) → 5242880 (5 MiB)
--
-- allowed_mime_types は 既存 の image/jpeg, image/png, image/webp を 維持。
-- =====================================================================

update storage.buckets
   set file_size_limit = 5242880  -- 5 MiB
 where id = 'avatar-images';
