-- =====================================================================
-- client_records に「流入・提案・求人元・面談メモ」の平文列を追加
--
-- 背景:
--   エージェントの他ツール(プロセス管理 CSV)の項目のうち、名簿として持って
--   おきたい重要項目が Myaira に無かった。CSV インポートで取り込めるよう、
--   以下を client_records に追加する。
--     ・inflow_job        流入求人(どの求人・経路で流入したか)
--     ・proposed_company  提案企業名(現在進行中の提案先のスナップショット)
--     ・job_source        求人元データ(求人の出所)
--     ・past_meeting_note 過去の面談日メモ(実施済み面談日の自由記述)
--
--   いずれも短い業務メモ(個人の機微な長文ではない)なので、entry_site / notes
--   と同じく平文で保持する。長文の所感系(meeting_notes 等)とは別扱い。
--
--   ※ 各応募・選考ステージの日付/面接官/売上等は「1求職者=複数応募」の履歴で
--     名簿の単一列には収まらないため対象外(応募管理側の領域)。
-- =====================================================================

alter table public.client_records
  add column if not exists inflow_job text,
  add column if not exists proposed_company text,
  add column if not exists job_source text,
  add column if not exists past_meeting_note text;

comment on column public.client_records.inflow_job is '流入求人(どの求人・経路で流入したか)。CSV 取込・名簿用の平文メモ。';
comment on column public.client_records.proposed_company is '提案企業名(現在進行中の提案先のスナップショット)。平文メモ。';
comment on column public.client_records.job_source is '求人元データ(求人の出所)。平文メモ。';
comment on column public.client_records.past_meeting_note is '過去の面談日メモ(実施済み面談日の自由記述)。平文メモ。';
