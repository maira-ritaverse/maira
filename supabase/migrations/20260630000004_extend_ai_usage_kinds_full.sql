-- =====================================================================
-- ai_usage_events.kind CHECK 制約 を 実装 に 合わせて 全 kind 受入 に 拡張
--
-- 経緯:
--   20260628000002 まで で whitelist が
--     ['photo_enhance', 'job_recommendation_seeker',
--      'job_recommendation_agency', 'recommendation_letter_draft']
--   の 4 種 しか 受け付けない 状態 だった。
--   一方 で コード では agency_cv_draft / agency_resume_draft /
--   job_extract_from_document / csv_column_mapping /
--   agency_recording_processed / seeker_* 等 を INSERT して おり、
--   recordAiUsage の try/catch で 黙殺 さ れた 結果、 これら の イベント が
--   1 件 も 記録 されて いなかった (= ダッシュボード の 「使用 済 / 残数」 が
--   実態 と 大きく ズレる 主要 因)。
--
-- 本 migration:
--   ・既存 制約 を drop し、 実装 で 使う 全 kind を 含む whitelist に
--     置き換える
--   ・新規 に agency_client_summary を 追加 (= D-2: クライアント詳細 の
--     AI 状況 サマリー も 課金 計上 する)
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
    'agency_client_summary'
  ));

comment on constraint ai_usage_events_kind_check on public.ai_usage_events is
  '対応 kind を 1 箇所 で 管理。 新規 機能 で kind を 増やす 際 は 本 制約 + lib/features/ai-usage.ts の AiUsageKind 型 + count_org_ai_usage_total_this_month の whitelist を 3 点 同時 に 更新 する こと。';

-- ---------------------------------------------------------------------
-- count_org_ai_usage_total_this_month の agency_org scope whitelist 更新
-- (agency_client_summary を 含める)
-- ---------------------------------------------------------------------
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
      'agency_client_summary'
    );

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.count_org_ai_usage_total_this_month(timestamptz) to authenticated;
