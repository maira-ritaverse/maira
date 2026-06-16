-- =====================================================================
-- AI 利用量トラッキング:ai_usage_events
--
-- 目的:
--   ・コストが線形に増える AI API 呼び出し(OpenAI gpt-image-1 / Claude
--     Sonnet 等)の月次利用回数をユーザ単位で記録
--   ・基本プラン無料枠 vs アドオン契約者で上限を出し分ける
--   ・将来はコスト分析にも転用できる
--
-- kind:
--   ・photo_enhance        … AI 証明写真化(gpt-image-1)
--   ・job_recommendation_seeker … 求職者向け AI 推薦(Claude)
--
-- セキュリティ:
--   ・本人のみ自分の行を SELECT 可
--   ・INSERT は API ルート(authenticated)経由のみ、本人の行のみ
-- =====================================================================

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'photo_enhance',
    'job_recommendation_seeker'
  )),
  -- 任意のメタデータ(resume_id / job count / モデル名など)
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- 月次集計の高速化に created_at descending + (user_id, kind) フィルタ前提
create index if not exists ai_usage_user_kind_created_idx
  on public.ai_usage_events (user_id, kind, created_at desc);

comment on table public.ai_usage_events is
  'AI 利用イベントログ(月次クォータ判定 + コスト分析用)';

alter table public.ai_usage_events enable row level security;

drop policy if exists ai_usage_self_select on public.ai_usage_events;
create policy ai_usage_self_select
  on public.ai_usage_events
  for select
  using (auth.uid() = user_id);

drop policy if exists ai_usage_self_insert on public.ai_usage_events;
create policy ai_usage_self_insert
  on public.ai_usage_events
  for insert
  with check (auth.uid() = user_id);
