-- =====================================================================
-- audit_action enum の同期(追補):platform_ai_quota_changed を追加
--
-- 背景:
--   20260819000006 で NDA / 利用規約系の enum 値を追加したが、TS 型
--   (lib/audit/audit-log.ts の AuditAction)にある platform_ai_quota_changed が
--   依然として DB enum に無かった。この値は運営者による AI 利用枠の変更
--   (app/api/admin/organizations/[id]/ai-quotas)で記録されるが、enum 違反で
--   INSERT が静かに失敗していた(recordAuditLog は非 strict)。
--
--   000006 は既に dev に適用済みのため編集せず、追補として本ファイルで冪等追加する。
--   ALTER TYPE ADD VALUE は本マイグレーション内では使用しないためトランザクション安全。
-- =====================================================================

alter type public.audit_action add value if not exists 'platform_ai_quota_changed';
