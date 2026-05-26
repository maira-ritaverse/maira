-- ============================================
-- conversations に書類タイプ等のメタデータを追加
--
-- 用途:
-- - 書類作成モジュール用に document_type を記録
-- - 将来の他モジュール拡張時にも metadata で対応可能
-- ============================================

alter table public.conversations
  add column if not exists metadata jsonb default '{}'::jsonb;

comment on column public.conversations.metadata is
  'モジュール固有のメタデータ(例: 書類作成なら document_type, job_info_preview 等)';

-- 既存レコードはデフォルト値が入る('{}')のでマイグレーション影響なし
