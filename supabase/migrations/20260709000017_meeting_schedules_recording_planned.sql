-- ============================================================================
-- meeting_schedules.recording_planned:録音予定フラグ
--
-- 目的:
--   ・カレンダー上で「この会議は録音するつもりだ」と事前にマーク可能にする
--   ・会議終了後に「録音予定だったのにアップロードされていない」ケースを検知
--     しやすくする(将来の cron 催促や UI バッジで使用)
--
-- 設計判断:
--   ・boolean で 十分。 事前決定は host 本人のみが行う想定なので、UI 側で
--     host_user_id = auth.uid() の場合のみトグル可能にする。RLS ポリシーは
--     既存の「host or admin update」で十分カバーされているため追加しない。
--   ・default false:既存レコードは「録音予定なし」として扱う(明示的にオプトイン)
--   ・recording_id が set された時点で「アップロード済」と判定できるので、
--     recording_planned は「アップロード予定」= 未アップロード状態の意思表示
--     専用フラグとして使う。
--
-- 用途:
--   ・カレンダー画面(agency/calendar)で mic バッジ表示
--     - recording_planned = true かつ recording_id null → 「録音予定」バッジ
--     - recording_id not null → 「録音済」バッジ
--   ・M5「会議録音 ワンクリック」の基点データ
-- ============================================================================

alter table public.meeting_schedules
  add column if not exists recording_planned boolean not null default false;

comment on column public.meeting_schedules.recording_planned is
  '会議を録音予定にするかのフラグ。true かつ recording_id が null の場合、UI で「録音予定」バッジを表示する。M5 会議録音ワンクリック機能の基点。';
