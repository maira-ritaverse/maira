-- =====================================================================
-- audit_logs の改修(運営機能 Phase 1 で本格使用するため)
--
-- 1) user_id を nullable + on delete set null に変更
--    なぜ:
--      account_deleted を記録した直後に profiles を消すフロー上、
--      on delete cascade だと監査ログ自体が消えてしまう。
--      法令対応上、削除イベントは本人 profile が消えた後も残す必要がある。
--      削除後の行は user_id = NULL になり、metadata に email / display_name を保存しておく。
--
-- 2) audit_action enum を拡張
--    - admin_force_deleted_user : 運営者がユーザを代理削除
--    - account_export_requested : 本人がデータエクスポートを要求(将来用)
--    - privacy_policy_accepted  : プライバシーポリシー同意(バージョン記録、将来用)
--    - admin_accessed_user      : 運営者が特定ユーザの情報を閲覧した(監査用)
--
-- 既存ポリシーへの影響なし(SELECT は user_id = auth.uid())、INSERT は service_role のみ。
-- =====================================================================

-- 1) user_id を nullable + on delete set null に
alter table public.audit_logs
  drop constraint if exists audit_logs_user_id_fkey;

alter table public.audit_logs
  alter column user_id drop not null;

alter table public.audit_logs
  add constraint audit_logs_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- 2) enum 拡張(ALTER TYPE ADD VALUE は idempotent 化のため IF NOT EXISTS で)
alter type public.audit_action add value if not exists 'admin_force_deleted_user';
alter type public.audit_action add value if not exists 'account_export_requested';
alter type public.audit_action add value if not exists 'privacy_policy_accepted';
alter type public.audit_action add value if not exists 'admin_accessed_user';

comment on column public.audit_logs.user_id is
  '操作対象ユーザ。本人削除後の監査ログは NULL に変わり、metadata に email を保持して追跡する。';
