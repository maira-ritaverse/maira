-- ============================================
-- notifications.encrypted_payload を現行の field-encryption 方式に移行
--
-- 背景:
--   notifications テーブルは初期定義(20260518000002)時点で
--     encrypted_payload bytea
--     encryption_iv     bytea
--   の旧方式(IV を別カラムに持つ)で作られたが、現行の暗号化ヘルパー
--   lib/crypto/field-encryption.ts(AES-256-GCM)は IV を暗号文に同梱した
--   "v{n}:base64url" 形式の text を返す。career_profiles と同じ問題のため、
--   同じ考え方で text 単一カラムに揃える。
--
-- 移行方針(career_profiles の 20260607000002/000003 と異なる点):
--   - notifications は dev/prod とも未利用(0 件確認済)。
--   - 既存データ保護(dual-write → backfill → verify → drop)は不要で、
--     1ステップで bytea を DROP し、同名で text を ADD し直す。
--   - カラム名は encrypted_payload のまま維持するため、既存インデックス
--     idx_notifications_user_unread(user_id, read_at, created_at desc) と
--     idx_notifications_pending(scheduled_at) where sent_at is null は
--     影響を受けない(これらは encrypted_payload を参照していない)。
--   - encryption_iv は新方式では使わないため DROP。
--   - RLS(SELECT/UPDATE = auth.uid()=user_id、INSERT ポリシーなし)は
--     カラム変更の影響を受けないため、そのまま維持される。
--
-- 適用範囲:
--   - dev (maira-dev: pfebbpgcufintmulhydg) に適用する。
--   - 将来 prod (maira-prod: xxatkimjfiaidxfuglae) に適用する際も、適用前に
--     prod の notifications 件数が 0 であることを確認すること
--     (非0 なら本マイグレーションは破壊的になる)。
-- ============================================

alter table public.notifications
  drop column if exists encrypted_payload,
  drop column if exists encryption_iv;

alter table public.notifications
  add column encrypted_payload text;

comment on column public.notifications.encrypted_payload is
  '通知ペイロード(タイトル/本文/参照IDなどの JSON)を AES-256-GCM で暗号化した文字列。'
  '"v{n}:base64url" 形式(IV は暗号文に同梱、レコードごとに新規生成)。'
  'lib/crypto/field-encryption.ts の encryptField/decryptField が読み書き境界。'
  'NULL 許容:配信前にペイロードが未確定なケース(将来のスケジュール通知等)を許容する。';
