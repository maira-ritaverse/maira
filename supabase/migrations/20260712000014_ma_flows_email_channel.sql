-- ============================================
-- ma_flows.channel に 'email' を許可
--
-- Phase B: Flow ビルダーを LINE 専用から公式 LINE / Eメール のマルチチャネルに拡張。
--
-- 設計方針:
--   ・既存の CHECK 制約(channel IN ('line'))を差し替えて 'email' を追加
--   ・identity(誰宛か)は当面 line_user_id ベースを維持
--     → LINE 連携済みの client_record にしか email Flow を enroll できない
--       (email-only lead は今のところ enroll できない)
--   ・executor 側で flow.channel を見て pushMessage / Resend を切り替える
--   ・LINE 連携済み client_record.email が空の場合はステップを skipped で終える
--
-- 制限(Phase B-1):
--   ・friend_added / tag_assigned / keyword_matched の trigger は本質的に LINE 依存
--     なので email 用途では意味が薄い。 admin が UI で選ぶ想定は
--     conversion_event / manual / form_submitted / segment_matched のみ。
-- ============================================

-- ────────────────────────────────────────
-- 1. CHECK 制約を付け替え
-- ────────────────────────────────────────
-- 既存の channel CHECK 制約(名前は自動命名で ma_flows_channel_check)を drop してから
-- 'email' を含む新しい CHECK を張り直す。
alter table public.ma_flows
  drop constraint if exists ma_flows_channel_check;

alter table public.ma_flows
  add constraint ma_flows_channel_check
  check (channel in ('line', 'email'));

comment on column public.ma_flows.channel is
  'line = 公式 LINE 経由の pushMessage、 email = Resend 経由のメール送信。 default line。';
