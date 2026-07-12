-- ============================================
-- ma_flow_audit_logs
--
-- 目的:
--   誰がいつ Flow を作成 / 編集 / 有効化 / 停止 / 削除したかを記録する監査台帳。
--   ・機密の中身は保存しない(diff_summary は「メタ変更した」「N ステップに変更」等の要約)
--   ・組織内のメンバーが「なぜこの Flow が変わったのか」を後追いできるようにする
--
-- 設計:
--   ・INSERT のみアプリ層(service_role)から。UPDATE / DELETE ポリシーは作らない
--   ・SELECT は組織メンバー全員(admin / advisor / member)
--   ・action は enum ではなく text にして、将来 action_type を増やす際の
--     マイグレーションを軽くする(値は下記コメント参照)
-- ============================================

create table if not exists public.ma_flow_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- 対象 Flow(削除された Flow の履歴も残す想定なので set null)
  flow_id uuid references public.ma_flows(id) on delete set null,

  -- どのアクションか(create / update_meta / update_steps / toggle_active / delete)
  action text not null,

  -- 実行者(auth.users)
  actor_user_id uuid references auth.users(id) on delete set null,

  -- 変更の要約。機密は含めない。
  --   例: {"fields":["name","description"]}
  --   例: {"step_count_before":3,"step_count_after":5}
  --   例: {"is_active_before":false,"is_active_after":true}
  diff_summary jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null default now()
);

comment on table public.ma_flow_audit_logs is
  'Flow 操作の監査台帳。 誰がいつ何を変えたかを追跡。';
comment on column public.ma_flow_audit_logs.action is
  'create / update_meta / update_steps / toggle_active / delete。 text にして将来拡張しやすく。';
comment on column public.ma_flow_audit_logs.diff_summary is
  '変更要約。 機密の中身(暗号化本文等)は含めない方針。';

-- 一覧表示用(組織内で新しい順)
create index if not exists idx_ma_flow_audit_org_time
  on public.ma_flow_audit_logs (organization_id, occurred_at desc);

-- Flow ごとの履歴表示用
create index if not exists idx_ma_flow_audit_flow_time
  on public.ma_flow_audit_logs (flow_id, occurred_at desc)
  where flow_id is not null;

-- ────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────

alter table public.ma_flow_audit_logs enable row level security;

create policy "ma_flow_audit_logs_select_own_org"
  on public.ma_flow_audit_logs
  for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE ポリシーは作らない = service_role のみ
