-- ============================================
-- ma_send_logs.scenario_id を nullable に (Flow ベース 送信 対応)
--
-- 旧 ma_scenarios (Phase 0 で 凍結) を 参照 する scenario_id は
-- 新 Flow 経由 の 送信 では NULL に なる。
-- 「scenario_id と ma_flow_step_id の どちら か 必須」 CHECK を 追加。
--
-- 関連 :
--   ・docs/line-lstep-ma-design.md §5 (既存 テーブル 拡張)
--   ・docs/line-lstep-ma-phase1-plan.md §4.2 (Dispatcher コア)
-- ============================================

-- Phase 0 で ma_flow_step_id 列 は 既に 追加 済 (20260711000003)。
alter table public.ma_send_logs
  alter column scenario_id drop not null;

-- どちら か の 由来 が 必須
alter table public.ma_send_logs
  drop constraint if exists ma_send_logs_source_either;
alter table public.ma_send_logs
  add constraint ma_send_logs_source_either
  check (scenario_id is not null or ma_flow_step_id is not null);

comment on constraint ma_send_logs_source_either on public.ma_send_logs is
  '送信 由来 は 旧 scenario_id か 新 ma_flow_step_id の どちら か 必須。 Phase 1 以降 の Flow 送信 は 後者 のみ。';
