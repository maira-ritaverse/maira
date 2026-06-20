-- ============================================
-- MA (マーケティング オートメーション) を LINE チャネル 対応 に 拡張
--
-- 既存 Email MA に 加え 「LINE 公式 アカウント 経由 の シナリオ 配信」を
-- 同じ プリセット / シナリオ / 送信ログ 基盤 で 動かせる ように する。
--
-- 変更:
--   1. ma_scenario_presets.channel CHECK 制約 を 'email' → ('email', 'line')
--   2. ma_send_logs に recipient_line_user_id 列 追加 + recipient_email を NULL 許容
--   3. LINE 用 プリセット 2 件 投入 (welcome / dormant)
--
-- ma_consent_log.feature は 既に ('email_ma', 'line_ma') 両方 許容 済 (20260615000001)。
-- ============================================

-- ────────────────────────────────────────
-- 1. ma_scenario_presets.channel を line も 受理 する よう に
-- ────────────────────────────────────────
alter table public.ma_scenario_presets
  drop constraint if exists ma_scenario_presets_channel_check;
alter table public.ma_scenario_presets
  add constraint ma_scenario_presets_channel_check
  check (channel in ('email', 'line'));

-- ────────────────────────────────────────
-- 2. ma_send_logs:LINE 配信 を 同じ テーブル で 記録 できる ように
--    recipient_email は LINE 配信 時 NULL に なる ので NULL 許容 へ。
--    どちら か 1 つ は 必須 (CHECK 制約)。
-- ────────────────────────────────────────
alter table public.ma_send_logs
  add column if not exists recipient_line_user_id text;

-- 既存 email NOT NULL を 解除
alter table public.ma_send_logs
  alter column recipient_email drop not null;

-- どちら か 必ず 入る 制約
alter table public.ma_send_logs
  drop constraint if exists ma_send_logs_recipient_either;
alter table public.ma_send_logs
  add constraint ma_send_logs_recipient_either
  check (recipient_email is not null or recipient_line_user_id is not null);

comment on column public.ma_send_logs.recipient_line_user_id is
  'LINE 配信 時 の 送信先 LINE userId。 メール 配信 時 は NULL。';

-- LINE userId で の 追跡 用 index
create index if not exists idx_ma_send_logs_line_user
  on public.ma_send_logs (recipient_line_user_id, sent_at desc)
  where recipient_line_user_id is not null;

-- ────────────────────────────────────────
-- 3. LINE 用 プリセット 投入
-- ────────────────────────────────────────
-- ON CONFLICT (key) DO NOTHING で、 重複 投入 を 防ぐ。
insert into public.ma_scenario_presets
  (key, audience, channel, name, description, trigger_event, default_trigger_days, sort_order)
values
  (
    'line_welcome_after_friend',
    'candidate',
    'line',
    'LINE 友達 追加 後 ウェルカム',
    '求職者 が 公式 LINE を 友達 追加 してから N 日 後 に、 ウェルカム メッセージ を 配信',
    'line_friend_added',
    0,
    110
  ),
  (
    'line_dormant_outreach',
    'candidate',
    'line',
    'LINE 休眠 求職者 掘り起こし',
    '求職者 が 最後 に LINE で 連絡 して から N 日 経過 した 場合 に 再 アプローチ',
    'line_last_inbound_threshold',
    30,
    120
  )
on conflict (key) do nothing;
