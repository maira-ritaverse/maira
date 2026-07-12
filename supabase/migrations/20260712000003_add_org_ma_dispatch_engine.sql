-- ============================================
-- organizations.ma_dispatch_engine で 旧 / 新 dispatcher を org 単位 に 切替
--
-- Phase 1 P1-D の カットオーバー フラグ。
--   ・'old'  : 旧 /api/internal/ma/line-dispatch が ma_scenarios を 処理 (現行)
--   ・'new'  : 新 /api/internal/ma/flow-dispatch が ma_flows を 処理
--
-- Stage 1 : 全 org 'old' の まま 新 cron を 起動 (処理 0 件)
-- Stage 2 : 1 org ずつ 'new' に 切替、 24h 観測
-- Stage 3 : 全 org 'new'、 旧 line-dispatch cron は 空 回り
-- Stage 4 : 旧 cron を vercel.json から 削除 + route コード 撤去
--
-- 設計 : docs/line-lstep-ma-phase1-plan.md §4.4
-- ============================================

alter table public.organizations
  add column if not exists ma_dispatch_engine text not null default 'old'
    check (ma_dispatch_engine in ('old', 'new'));

comment on column public.organizations.ma_dispatch_engine is
  'MA 配信 の 実行 系統。 old = 旧 line-dispatch (ma_scenarios) / new = 新 flow-dispatch (ma_flows)。 Phase 1 の 段階 移行 用 フラグ。';

-- 'new' 側 を 見つけ やすく する ため の 部分 index
create index if not exists idx_organizations_ma_dispatch_engine_new
  on public.organizations(ma_dispatch_engine)
  where ma_dispatch_engine = 'new';
