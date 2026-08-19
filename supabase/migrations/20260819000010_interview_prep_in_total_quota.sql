-- =====================================================================
-- 組織「総量」クォータ RPC に agency_interview_prep を追加(重要:経済保護)
--
-- 背景:
--   20260819000009 で agency_interview_prep(agency_org scope)を CHECK 制約と
--   AiUsageKind 型に追加したが、組織全体の月次「総量」上限を数える RPC
--   count_org_ai_usage_total_this_month の whitelist に入れ忘れていた。
--
--   この漏れがあると、面接対策の生成が組織総量(500/1000)に計上されず、
--   総量上限でも止まらない(= 経済保護の天井をすり抜ける)。20260717000003 の
--   ヘッダが明記する「CHECK 制約 + AiUsageKind 型 + この RPC の whitelist を
--   3 点同時更新」の 3 点目の是正。
--
--   現行定義(20260717000003)を厳密にミラーし、whitelist に新 kind を 1 行追加する。
-- =====================================================================

create or replace function public.count_org_ai_usage_total_this_month(
  p_month_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
  v_count integer;
begin
  select organization_id into v_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_org_id is null then
    return 0;
  end if;

  select count(*)::integer into v_count
  from public.ai_usage_events e
  join public.organization_members m on m.user_id = e.user_id
  where m.organization_id = v_org_id
    and e.created_at >= p_month_start
    and e.kind in (
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
      -- 20260819000009 で追加した面接対策(経済保護のため総量に計上)
      'agency_interview_prep'
    );

  return coalesce(v_count, 0);
end;
$$;
