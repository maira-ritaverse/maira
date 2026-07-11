-- ============================================
-- 旧 ma_scenarios の 新規 INSERT を 凍結
--
-- Phase 0 で 新 ma_flows 体系 に 集約 する 判断 (ADR 0007) に 基づく。
-- 既存 行 は 監査 目的 で 残す。 UPDATE (is_active の 切替 等) は
-- Phase 1 で 旧 line-dispatch cron を 撤去 する まで 引き続き 可能。
--
-- 手法 :
--   1. 凍結 開始 日 を 記録 する frozen_at 列 を 追加
--   2. INSERT を 拒否 する 関数 トリガー を 付与
--
-- 関連 :
--   ・docs/line-lstep-ma-design.md
--   ・docs/adr/0007-line-lstep-ma-flow.md
--   ・docs/line-lstep-ma-phase0-plan.md §5
-- ============================================

-- 凍結 開始 日 を 記録 (監査 用)
alter table public.ma_scenarios
  add column if not exists frozen_at timestamptz;

comment on column public.ma_scenarios.frozen_at is
  '新規 INSERT を 拒否 する ように なった 日。 Phase 0 完了 時 に 既存 行 の 参考 情報 として 記録。';

-- 既存 行 に frozen_at を 記録
update public.ma_scenarios
  set frozen_at = now()
  where frozen_at is null;

-- 以降 の INSERT を 拒否 する 関数
create or replace function public.reject_ma_scenarios_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception '[Phase 0] ma_scenarios は 凍結 されました。 新規 シナリオ は public.ma_flows を 使用 して ください。 詳細 : docs/adr/0007-line-lstep-ma-flow.md';
end;
$$;

drop trigger if exists reject_ma_scenarios_insert on public.ma_scenarios;
create trigger reject_ma_scenarios_insert
  before insert on public.ma_scenarios
  for each row execute function public.reject_ma_scenarios_insert();

-- 注意 : UPDATE / DELETE は 依然 として 可能 に して おく。
-- Phase 1 で 旧 line-dispatch cron が 撤去 された あと に、
-- 別 migration で テーブル 全体 を read-only 化 する。
