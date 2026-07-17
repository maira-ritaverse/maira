-- =====================================================================
-- ai_usage_events.kind CHECK 制約 に 未反映 の 6 kind を 追加
--
-- 経緯:
--   20260630000004 で CHECK 制約 と count_org_ai_usage_total_this_month RPC
--   の whitelist を 「実装 で 使う 全 kind」 に 揃えた が、 その 後 コード に
--   追加 された kind が 制約 に 反映 されて いなかった。
--
--   ・agency_line_reply_suggest         (LINE 会話 → 返信 案 生成)
--   ・agency_line_client_extract        (LINE 会話 → 顧客情報 抽出)
--   ・agency_ma_flow_generation         (Flow ビルダー AI 生成)
--   ・agency_ma_segment_generation      (Segment ビルダー AI 生成)
--   ・agency_ma_flow_improvement        (Flow 改善 提案)
--   ・agency_client_document_extract    (求職者 元書類 → プロフィール反映、 2026-07-17 追加)
--
--   これら の kind を INSERT しよう と する と CHECK 制約 で 弾かれる が、
--   recordAiUsage が try/catch で silently console.warn する だけ の 実装
--   な ため、 発火 に 気付か ず 以下 の 実害 が 発生 して いた:
--     (a) ai_usage_events に 1 件 も 記録 されない
--     (b) countOrgAiUsageThisMonth(kind) が 常に 0 → kind 別 月次上限 が 効かない
--     (c) count_org_ai_usage_total_this_month が これ ら を 除外 → 組織 総量 上限
--         (500/1000) に も 計上 されない = 実質 上限 なし
--     (d) 管理画面 の 「使用済 / 残数」 表示 が 実態 と 乖離
--
-- 本 migration:
--   ・CHECK 制約 の whitelist を 更新
--   ・count_org_ai_usage_total_this_month RPC の agency_org scope kinds
--     whitelist を 同時 に 更新
--
-- 適用:
--   dev / prod どちら も SUPABASE_DB_PASSWORD 未設定 の 現行 運用 の ため、
--   Supabase Dashboard の SQL Editor から 手動 適用 が 必要 (Phase 1 と 同型)。
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
    -- ここ から 20260630000004 以降 に コード 側 で 追加 された 未反映 分
    'agency_line_reply_suggest',
    'agency_line_client_extract',
    'agency_ma_flow_generation',
    'agency_ma_segment_generation',
    'agency_ma_flow_improvement',
    'agency_client_document_extract'
  ));

comment on constraint ai_usage_events_kind_check on public.ai_usage_events is
  '対応 kind を 1 箇所 で 管理。 新規 機能 で kind を 増やす 際 は 本 制約 + lib/features/ai-usage.ts の AiUsageKind 型 + count_org_ai_usage_total_this_month の whitelist を 3 点 同時 に 更新 する こと。';

-- ---------------------------------------------------------------------
-- count_org_ai_usage_total_this_month の agency_org scope whitelist 更新
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
      'agency_client_summary',
      -- 追加 分
      'agency_line_reply_suggest',
      'agency_line_client_extract',
      'agency_ma_flow_generation',
      'agency_ma_segment_generation',
      'agency_ma_flow_improvement',
      'agency_client_document_extract'
    );

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.count_org_ai_usage_total_this_month(timestamptz) to authenticated;
