-- =====================================================================
-- AI 求人推薦キャッシュ:client_job_ai_recommendations
--
-- 目的:
--   ・エージェント企業が抱える求人(job_postings)を、求職者の
--     キャリア棚卸し / 診断結果 / 希望条件 をもとに Claude で
--     ランキング(top N + 理由)し、結果をキャッシュする
--   ・棚卸し更新や求人追加で「入力ハッシュ」が変わったら再計算
--
-- セキュリティ:
--   ・rationale は career_profile 由来の情報を含むため AES-256-GCM 暗号化
--   ・RLS は organization メンバーのみ select 可(認可は他テーブルと同様)
--   ・INSERT/UPDATE は API ルート(server)経由
-- =====================================================================

create table if not exists public.client_job_ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null unique
    references public.client_records(id) on delete cascade,
  -- 暗号化された JSON: { items: [{ job_posting_id, score, rationale }] }
  encrypted_rankings text not null,
  -- 入力データの SHA-256 ハッシュ(career_profile_updated_at + open_jobs ID/updated_at リスト)
  inputs_hash text not null,
  generated_at timestamptz not null default now()
);

create index if not exists cjar_org_idx
  on public.client_job_ai_recommendations (organization_id);

create index if not exists cjar_generated_idx
  on public.client_job_ai_recommendations (generated_at desc);

comment on table public.client_job_ai_recommendations is
  'AI 求人推薦キャッシュ(クライアント × 自社求人)。Claude による top N + 理由。';

-- ───────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────
alter table public.client_job_ai_recommendations enable row level security;

drop policy if exists cjar_org_select on public.client_job_ai_recommendations;
create policy cjar_org_select
  on public.client_job_ai_recommendations
  for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists cjar_org_insert on public.client_job_ai_recommendations;
create policy cjar_org_insert
  on public.client_job_ai_recommendations
  for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists cjar_org_update on public.client_job_ai_recommendations;
create policy cjar_org_update
  on public.client_job_ai_recommendations
  for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists cjar_org_delete on public.client_job_ai_recommendations;
create policy cjar_org_delete
  on public.client_job_ai_recommendations
  for delete
  using (organization_id = public.current_user_organization_id());
