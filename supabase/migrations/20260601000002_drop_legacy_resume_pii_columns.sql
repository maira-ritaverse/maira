-- ============================================
-- 履歴書 旧個別 PII カラムの削除(Step 3c:blob-only 化)
--
-- このマイグレーションは破壊的(DROP COLUMN を含む)。
-- 適用は maira-dev のみ。maira-prod への適用はリリース準備フェーズで
-- 明示指示の上で別途行う。
--
-- 前提:
--   - Step 3a で encrypted_pii 列を追加し dual-write を開始
--   - Step 3b でバックフィル + 検証(差分 0 / encrypted_pii NULL 行 0)を確認
--   - lib/resumes/queries.ts は blob-only に切替済み
--
-- 削除対象は lib/resumes/pii-fields.ts の RESUME_PII_FIELDS が
-- ミラーしていた個別 PII カラムのみ。
--
-- 保持(明示的に対象外):
--   id, user_id, title, document_date, encrypted_pii,
--   created_at, updated_at, および idx_resumes_user_id インデックス
--   と既存 RLS ポリシー 4 件はすべて維持する。
--
-- 元に戻せない操作のため、適用前に scripts/backfill-resume-pii.ts の
-- --mode=verify が PASS していることを必ず確認すること。
-- ============================================

alter table public.resumes
  -- 本人基本情報
  drop column if exists name,
  drop column if exists name_kana,
  drop column if exists birth_date,
  drop column if exists gender, -- CHECK 制約は列とともに自動削除される
  -- 現住所
  drop column if exists postal_code,
  drop column if exists address,
  drop column if exists address_kana,
  drop column if exists phone,
  drop column if exists email,
  -- 連絡先(現住所と異なる場合)
  drop column if exists contact_address,
  drop column if exists contact_address_kana,
  drop column if exists contact_phone,
  -- 写真
  drop column if exists photo_url,
  -- 学歴・職歴 / 免許・資格(jsonb)
  drop column if exists education_history,
  drop column if exists licenses,
  -- 自由記述
  drop column if exists motivation_note,
  drop column if exists personal_requests;

-- ============================================
-- メモ:DROP 後の resumes テーブル列は以下のみとなる
--   id, user_id, title, document_date, encrypted_pii,
--   created_at, updated_at
-- ============================================
