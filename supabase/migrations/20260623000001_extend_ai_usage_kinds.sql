-- =====================================================================
-- ai_usage_events.kind に 'job_recommendation_agency' を追加
--
-- エージェント(org メンバー)側でクライアント詳細を開いた際の AI 求人推薦も
-- コスト分析・クォータ管理の対象に含めるため、check 制約を拡張する。
-- 既存データは photo_enhance / job_recommendation_seeker のみのため、互換性影響なし。
-- =====================================================================

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_kind_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_kind_check
  check (kind in (
    'photo_enhance',
    'job_recommendation_seeker',
    'job_recommendation_agency'
  ));
