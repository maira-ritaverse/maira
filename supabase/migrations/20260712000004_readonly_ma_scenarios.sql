-- ============================================
-- 旧 ma_scenarios を 完全 read-only 化
--
-- Phase 1 P1-H の カットオーバー 最終 段階。 Phase 0 で INSERT は 拒否 済 だが、
-- UPDATE / DELETE も 拒否 して 実質 read-only に する。
-- 既存 行 は 監査 目的 で 残す。 テーブル 自体 の DROP は 更に 1 リリース 後 に 検討。
--
-- 旧 line-dispatch cron の Vercel 側 登録 も 同時 に 削除 (vercel.json)。
-- 旧 route コード は 1 リリース 残す (障害 時 の 緊急 復旧 用)。
--
-- ma_templates / ma_send_logs / ma_click_links は 引き続き 書込み 可能
-- (新 Flow 体系 からも 参照 する ため)。
--
-- 注意 : UPDATE / DELETE 拒否 トリガー を 作る 前 に 、
--        read_only_since 列 を UPDATE で 埋める 必要 が ある ため 順序 厳守。
-- ============================================

-- 1. まず read_only_since 列 を 追加 + 埋める (トリガー 追加 前)
alter table public.ma_scenarios
  add column if not exists read_only_since timestamptz;

update public.ma_scenarios
  set read_only_since = now()
  where read_only_since is null;

comment on column public.ma_scenarios.read_only_since is
  'テーブル が 完全 read-only 化 された 日時。 監査 用。';

-- 2. UPDATE 拒否 トリガー
create or replace function public.reject_ma_scenarios_update()
returns trigger
language plpgsql
as $$
begin
  raise exception '[Phase 1 P1-H] ma_scenarios は 完全 read-only です。 新 ma_flows を 使用 して ください。 詳細 : docs/adr/0007-line-lstep-ma-flow.md';
end;
$$;

drop trigger if exists reject_ma_scenarios_update on public.ma_scenarios;
create trigger reject_ma_scenarios_update
  before update on public.ma_scenarios
  for each row execute function public.reject_ma_scenarios_update();

-- 3. DELETE 拒否 トリガー
create or replace function public.reject_ma_scenarios_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '[Phase 1 P1-H] ma_scenarios は 完全 read-only です。 監査 目的 で 保持 必須 の ため 削除 でき ません。';
end;
$$;

drop trigger if exists reject_ma_scenarios_delete on public.ma_scenarios;
create trigger reject_ma_scenarios_delete
  before delete on public.ma_scenarios
  for each row execute function public.reject_ma_scenarios_delete();
