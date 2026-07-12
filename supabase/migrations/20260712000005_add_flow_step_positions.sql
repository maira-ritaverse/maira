-- ============================================
-- ma_flow_steps.position_x / position_y (Flow ビルダー の 自由 配置)
--
-- Phase 1-F.2 (自由 DAG エディタ) の 位置 情報 永続化。
-- null の 場合 は Flow ビルダー が step_order 順 の 自動 縦積み で 復元 する。
-- ============================================

alter table public.ma_flow_steps
  add column if not exists position_x double precision,
  add column if not exists position_y double precision;

comment on column public.ma_flow_steps.position_x is
  'Flow ビルダー キャンバス 上 の X 座標。 null なら 自動 レイアウト。';
comment on column public.ma_flow_steps.position_y is
  'Flow ビルダー キャンバス 上 の Y 座標。 null なら 自動 レイアウト。';
