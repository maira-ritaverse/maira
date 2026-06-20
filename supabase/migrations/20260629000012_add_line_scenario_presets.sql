-- ============================================
-- LINE MA 用 シナリオ プリセット を 5 件 追加
--
-- 既存 (20260629000007) で line_welcome_after_friend / line_dormant_outreach の
-- 2 件 を 投入 済 だが、 EMPRO に 揃える ため Email 7 件 と 対応 する LINE 版
-- 5 件 を 追加 する。
--
-- Email 側 と key を 区別 (line_ プレフィックス) し、 Edge Function / cron 側 で
-- 同一 ロジック で 動か せる ように 既存 IMPLEMENTED_SCENARIO_KEYS の
-- 対応 関係 と 一致 さ せる (= Web 側 で is_implemented 判定 を 通る 名前)。
-- ============================================

insert into public.ma_scenario_presets
  (key, audience, channel, name, description, trigger_event, default_trigger_days, sort_order)
values
  (
    'line_register_meeting_promotion',
    'candidate',
    'line',
    'LINE 登録者 への 面談 促進',
    '友達 追加 から N 日 経過 し、 面談 日 が 未設定 の 場合 に LINE で 案内',
    'line_friend_added_no_meeting',
    3,
    130
  ),
  (
    'line_meeting_reminder',
    'candidate',
    'line',
    'LINE 面談前 リマインド',
    '求職者 の 面談 日 の N 日前 に LINE で リマインド',
    'meeting_scheduled',
    -1,
    140
  ),
  (
    'line_job_introduction',
    'candidate',
    'line',
    'LINE 求人 紹介',
    '面談 完了 後 N 日 経過 し、 応募 が ない 場合 に LINE で 求人 を 紹介',
    'meeting_done_no_application',
    3,
    150
  ),
  (
    'line_after_interview_followup',
    'candidate',
    'line',
    'LINE 面接後 フォロー',
    '面接 確定 日 から N 日後 に LINE で フォロー',
    'interview_done',
    1,
    160
  ),
  (
    'line_birthday_greeting',
    'candidate',
    'line',
    'LINE 誕生日 お祝い',
    '求職者 の 誕生日 当日 に LINE で お祝い メッセージ',
    'candidate_birthday',
    0,
    170
  )
on conflict (key) do nothing;
