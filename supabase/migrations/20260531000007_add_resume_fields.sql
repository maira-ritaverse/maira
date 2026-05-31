-- ============================================
-- 履歴書フィールド追加(厚労省様式の完全化)
--
-- Phase 2-A のプレビューを作った際、厚労省様式に必要な以下のフィールドが
-- Phase 1 のデータモデルに無かったため追加する。
--
--   - motivation_note: 志望の動機、特技、好きな学科、アピールポイント等
--   - contact_address_kana: 連絡先のふりがな
--   - contact_phone: 連絡先の電話番号
--
-- 全カラム nullable(既存の履歴書レコードを壊さない)。
-- ============================================

alter table public.resumes
  add column if not exists motivation_note text,
  add column if not exists contact_address_kana text,
  add column if not exists contact_phone text;

comment on column public.resumes.motivation_note is '志望の動機、特技、好きな学科、アピールポイント等(厚労省様式の自由記述欄)';
comment on column public.resumes.contact_address_kana is '連絡先のふりがな';
comment on column public.resumes.contact_phone is '連絡先の電話番号';
