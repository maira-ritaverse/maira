-- ============================================
-- LINE 自動 歓迎 メッセージ (line_channels 拡張)
--
-- 役割:
--   ・友達追加 (follow イベント) 時 に 自動 送信 する 歓迎 メッセージ
--   ・Reply で 送信 (= 課金 通数 0、 Reply Token が follow イベントに 付く)
--   ・on/off + 本文 を 管理者 が 設定
--
-- 機密扱い:
--   ・welcome_message は エージェント の 営業 文言 (機密性 中程度)
--   ・暗号化保存 (encrypted_) で 統一
-- ============================================

alter table public.line_channels
  add column if not exists welcome_message_enabled boolean not null default false,
  add column if not exists welcome_message_encrypted text;

comment on column public.line_channels.welcome_message_enabled is
  'follow イベント 時 に 自動 で 歓迎 メッセージ を 送信 する か。';
comment on column public.line_channels.welcome_message_encrypted is
  'AES-256-GCM 暗号化 された 歓迎 メッセージ 本文 (最大 5000 字)。';
