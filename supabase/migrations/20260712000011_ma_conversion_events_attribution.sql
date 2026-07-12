-- ============================================
-- ma_conversion_events に attribution 列を追加
--
-- 目的:
--   CV が発生した時点で、その求職者が「直近で経験していた Flow」を記録する。
--   ・attributed_flow_ids:過去 30 日以内に active/completed だった flow_id 一覧
--   ・last_touch_flow_id :最後に到達した Flow(単一帰属したい時の主要指標)
--
-- なぜ:
--   1 求職者に複数 Flow が並行して走ることが多いので「1 CV = 1 Flow」の帰属は
--   固定しづらい。全 Flow を配列で持ちつつ、last-touch を単一値で併記して
--   両方の集計軸を保つ。
--
--   ALTER TABLE で列追加のみ。既存の 20260712000010 マイグレーションは
--   触らない(CLAUDE.md 遵守)。
-- ============================================

alter table public.ma_conversion_events
  add column if not exists attributed_flow_ids uuid[] not null default '{}',
  add column if not exists last_touch_flow_id uuid
    references public.ma_flows(id) on delete set null;

comment on column public.ma_conversion_events.attributed_flow_ids is
  '直近30日以内に active/completed だった Flow ID 一覧。「貢献した Flow」の全集合。';
comment on column public.ma_conversion_events.last_touch_flow_id is
  '最後に到達した Flow(single-attribution 集計用の主要指標)。';

-- Flow ダッシュボードで「この Flow が貢献した CV」を引く用
create index if not exists idx_ma_conversion_events_last_touch
  on public.ma_conversion_events (last_touch_flow_id, event_key, occurred_at desc)
  where last_touch_flow_id is not null;

-- attributed_flow_ids で「◯◯ Flow が絡んだ CV」を引く用(GIN)
create index if not exists idx_ma_conversion_events_attributed_gin
  on public.ma_conversion_events using gin (attributed_flow_ids);
