-- ============================================
-- 履歴書 PII の暗号化格納列を追加(Step 3a:dual-write の受け皿)
--
-- 目的:
--   docs/encryption-manifest.md の方針(案 C / PII 統合)に従い、
--   resumes の text 系 PII を JSON にまとめて AES-256-GCM で暗号化した
--   文字列を 1 列に格納する。アプリ層(lib/resumes/queries.ts)で
--   書き込み時に暗号化、読み取り時に復号する境界を作る。
--
-- このマイグレーションは「追加のみ・破壊なし」:
--   - 既存の name / address / phone 等の個別 PII カラムは一切触らない
--   - encrypted_pii は NULL 許容・デフォルトなし(既存行は影響を受けない)
--   - RLS は行レベルなので既存ポリシーがそのまま新カラムにも効く
--     → 追加ポリシーは不要
--
-- 後段:
--   Step 3b でバックフィル、Step 3c で個別 PII カラムの削除を検証後に実施。
-- ============================================

alter table public.resumes
  add column if not exists encrypted_pii text;

comment on column public.resumes.encrypted_pii is
  '履歴書 PII を JSON 化して AES-256-GCM 暗号化した文字列("v{n}:base64url" 形式)。lib/resumes/queries.ts が読み書き境界。NULL は移行前の行を意味する(Step 3b で全件バックフィル予定)。';
