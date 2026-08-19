-- =====================================================================
-- 面接対策(interview_preps)
--
-- エージェントが、特定の求職者(client_record)× 特定の求人(job_posting)=
-- referral に対して、AI で生成する面接対策(企業研究ポイント・想定質問・
-- 回答の方向性・キャリアビジョンの組み立て等)。
--
-- 構成:
--   ・referral 1 件に対して 1 つ(最新で上書き)。再生成すると内容を差し替える。
--   ・内容は候補者の経歴・志望動機を含む機密情報のため、lib/crypto/field-encryption.ts
--     で AES-256-GCM 暗号化して保存(v{n}:base64url(iv ‖ ct+tag))。
--
-- セキュリティ:
--   ・recommendation_letters と同じ RLS パターン(組織メンバーは閲覧/追加/更新可、
--     削除は admin のみ)。
-- =====================================================================

create table if not exists public.interview_preps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- referral が消えたら面接対策も無意味になるので cascade。referral 単位で一意。
  referral_id uuid not null references public.referrals(id) on delete cascade,

  -- 暗号化済の面接対策本文(構造化 JSON を暗号化して格納)。
  encrypted_content text not null check (length(encrypted_content) <= 40000),

  -- 生成に使ったモデル(監査・再現性の記録用、任意)
  model text,

  -- 生成者(メンバーが抜けた履歴では null になり得る)
  generated_by_member_id uuid references public.organization_members(id) on delete set null,
  generated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- referral 1 件につき 1 つ
  unique (referral_id)
);

comment on table public.interview_preps is
  '面接対策(referral 単位・AI 生成)。内容は AES-256-GCM 暗号化。';
comment on column public.interview_preps.encrypted_content is
  'AES-256-GCM(v{n}:base64url(iv ‖ ct+tag))。構造化 JSON を暗号化。lib/crypto/field-encryption.ts で復号。';

create index if not exists interview_preps_org_idx
  on public.interview_preps (organization_id);
create index if not exists interview_preps_referral_idx
  on public.interview_preps (referral_id);

-- 更新日時の自動セット
drop trigger if exists set_interview_preps_updated_at on public.interview_preps;
create trigger set_interview_preps_updated_at
  before update on public.interview_preps
  for each row execute function public.set_updated_at();

-- ===========================
-- RLS:recommendation_letters と同パターン
-- ===========================
alter table public.interview_preps enable row level security;

drop policy if exists "Members can view interview preps in their organization"
  on public.interview_preps;
create policy "Members can view interview preps in their organization"
  on public.interview_preps for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists "Members can insert interview preps in their organization"
  on public.interview_preps;
create policy "Members can insert interview preps in their organization"
  on public.interview_preps for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Members can update interview preps in their organization"
  on public.interview_preps;
create policy "Members can update interview preps in their organization"
  on public.interview_preps for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists "Admins can delete interview preps in their organization"
  on public.interview_preps;
create policy "Admins can delete interview preps in their organization"
  on public.interview_preps for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- =====================================================================
-- ai_usage_events.kind に 'agency_interview_prep' を追加
--   (lib/features/ai-usage.ts の AiUsageKind と同期。20260717000003 の全値 + 新値)
-- =====================================================================
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_kind_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_kind_check
  check (kind in (
    -- 求職者 (seeker_per_user スコープ)
    'photo_enhance',
    'job_recommendation_seeker',
    'seeker_resume_create',
    'seeker_cv_create',
    'seeker_resume_ai_draft',
    'seeker_cv_ai_draft',
    -- エージェント (agency_org スコープ)
    'job_recommendation_agency',
    'recommendation_letter_draft',
    'agency_cv_draft',
    'agency_resume_draft',
    'job_extract_from_document',
    'csv_column_mapping',
    'agency_recording_processed',
    'agency_client_summary',
    'agency_line_reply_suggest',
    'agency_line_client_extract',
    'agency_ma_flow_generation',
    'agency_ma_segment_generation',
    'agency_ma_flow_improvement',
    'agency_client_document_extract',
    'agency_interview_prep'
  ));
