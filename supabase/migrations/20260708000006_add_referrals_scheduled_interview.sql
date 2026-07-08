-- =====================================================================
-- referrals に 「企業 と の 面接 予定 日時」 列 を 追加
--
-- 動機:
--   従来 は referrals.status を 'interview' に 遷移 させ た 記録 (referral_status_history)
--   は あった が、 「実際 の 面接 日時」 を 保存 する カラム が 無く、 カレンダー
--   画面 に 企業 面接 予定 を 出す 手段 が 存在 し な かった。
--
--   1 応募 に つき 1 次 / 2 次 / 最終 と 複数 面接 が ある が、 まずは 「直近 の
--   予定 1 回 分」 を 保持 する シンプル な モデル で 開始。 履歴 管理 が 必要 に
--   なった 時点 で 別 テーブル (referral_interviews) に 移行 できる 想定。
--
-- 追加 列:
--   ・scheduled_interview_at (timestamptz null) - 直近 の 企業 面接 予定 日時
--   ・interview_note         (text null)        - 面接 の 補足 (「対面」「Zoom」等)
-- =====================================================================

alter table public.referrals
  add column if not exists scheduled_interview_at timestamptz,
  add column if not exists interview_note text;

comment on column public.referrals.scheduled_interview_at is
  '直近 の 企業 面接 予定 日時 (何 次 か は 現状 は 履歴 管理 しない)。 カレンダー 表示 に 使う。';
comment on column public.referrals.interview_note is
  '面接 の 補足 メモ (「対面 @ 品川」 「オンライン (Zoom)」 「1 次 面接」 など)。 平文 保存。';

-- カレンダー 画面 が 「期間 内 の 面接 予定」 を 引く の で 部分 index を 貼る
create index if not exists idx_referrals_scheduled_interview
  on public.referrals (organization_id, scheduled_interview_at)
  where scheduled_interview_at is not null;
