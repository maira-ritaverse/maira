-- =====================================================================
-- line_user_links.stale_alerted_at — 3 日 連絡 なし 通知 の 重複 抑制 用
--
-- 目的:
--   ・30 分 毎 の cron が 「3 日 連絡 なし」 で 通知 を 送る 際、
--     同じ 会話 に 対して 24 時間 以内 の 再 通知 を 防ぐ。
--   ・last_activity_at が 進む (顧客 が 返信 した) と自然 に 再 対象 化 される。
--
-- 動作:
--   ・cron が 通知 発火 と 同時 に stale_alerted_at = now() を セット
--   ・次 回 の 抽出 条件 に stale_alerted_at IS NULL OR stale_alerted_at < now() - '24 hours'
--   ・handled_at (対応 済み) が セット されて いる 顧客 は そもそも 対象 外
-- =====================================================================

alter table public.line_user_links
  add column if not exists stale_alerted_at timestamptz;

comment on column public.line_user_links.stale_alerted_at is
  '3 日 連絡 なし 通知 を 最後 に 送った 時刻。 cron の 重複 発火 抑制 用 (24 時間 クール ダウン)。';
