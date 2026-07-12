-- ============================================
-- ma_templates.scenario_id を nullable 化 + 独立 テンプレ 対応
--
-- Phase 1-AI.4 の 「AI Flow 生成 時 に send_message 用 テンプレ を 自動 作成」
-- の 前提。 旧 ma_scenarios (凍結 済) に 依存 しない 独立 テンプレ を 保存
-- できる ように する。
--
-- 変更:
--   1. scenario_id を nullable に (旧 制約 UNIQUE (scenario_id) は
--      PostgreSQL の 仕様 で NULL 複数 許容 の ため そのまま で 良い)
--   2. 独立 テンプレ 用 の name 列 を 追加
--   3. CHECK 制約:scenario_id か name の どちら か 必須
-- ============================================

-- 1. scenario_id を nullable に
alter table public.ma_templates
  alter column scenario_id drop not null;

comment on column public.ma_templates.scenario_id is
  '旧 ma_scenarios 由来 の テンプレ の 場合 に セット。 AI 生成 等 の 独立 テンプレ は NULL。';

-- 2. 独立 テンプレ 用 の name 列
alter table public.ma_templates
  add column if not exists name text;

comment on column public.ma_templates.name is
  '独立 テンプレ (scenario_id が NULL) の 表示 名。 例:「AI: 面談 誘導 Flow の Step 2」';

-- 3. scenario_id か name か どちら か 必須
alter table public.ma_templates
  drop constraint if exists ma_templates_identity_either;
alter table public.ma_templates
  add constraint ma_templates_identity_either
  check (scenario_id is not null or name is not null);

-- 独立 テンプレ の 一覧 検索 用 index
create index if not exists idx_ma_templates_org_standalone
  on public.ma_templates(organization_id, updated_at desc)
  where scenario_id is null;
