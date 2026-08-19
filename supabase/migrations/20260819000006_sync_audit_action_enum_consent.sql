-- =====================================================================
-- audit_action enum を lib/audit/audit-log.ts の AuditAction 型と同期する
--
-- 背景:
--   NDA / 利用規約の同意ゲート(consent accept)は監査ログに nda_accepted /
--   terms_accepted を記録する。しかし audit_action enum にはこれらの値が
--   追加されていなかったため、INSERT が enum 違反となり記録が静かに失敗していた
--   (recordAuditLog は非 strict のため握りつぶす)。
--
--   ここで不足していた値を冪等(add value if not exists)で追加し、TS 型と DB enum を
--   一致させる。ALTER TYPE ADD VALUE は本マイグレーション内では使用しないため、
--   トランザクション内追加でも問題ない。
--
-- 対象:
--   ・nda_accepted            … NDA 同意(既存 NDA 機能でも未追加だった)
--   ・nda_signature_requested … 運営者からの NDA 署名依頼リマインド(同上)
--   ・terms_accepted          … 利用規約 同意(本フェーズで追加)
-- =====================================================================

alter type public.audit_action add value if not exists 'nda_accepted';
alter type public.audit_action add value if not exists 'nda_signature_requested';
alter type public.audit_action add value if not exists 'terms_accepted';
