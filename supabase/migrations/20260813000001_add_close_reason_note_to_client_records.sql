-- =====================================================================
-- client_records に「見送り/失注の詳細理由(自由記述)」列を追加
--
-- 背景:
--   close_reason(カテゴリ enum: 他社サービス選択 / 自己応募 / 連絡途絶 等)は
--   既にあり KPI 集計に使えるが、「なぜ失注したか」の具体(例: 提示年収が競合より
--   50万低かった)を残せず、失注防止の分析に粒度が足りなかった。
--   カテゴリと対になる自由記述の詳細理由を追加する。
--
-- 暗号化:
--   詳細理由は求職者個人の状況に触れうる機微情報なので、他の自由記述
--   (recommendation_comment / meeting_notes / status_memo)と同じく
--   AES-256-GCM でサーバーサイド暗号化して encrypted_ 列に保存する(平文で持たない)。
-- =====================================================================

alter table public.client_records
  add column if not exists encrypted_close_reason_note text;

comment on column public.client_records.encrypted_close_reason_note is
  '見送り/失注の詳細理由(自由記述)を AES-256-GCM 暗号化して保存。close_reason(カテゴリ)と対で失注分析に使う。';
