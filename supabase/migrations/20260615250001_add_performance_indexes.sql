-- =====================================================================
-- パフォーマンスインデックス追加(docs/perf-audit.md より)
--
-- 1) client_interactions(client_record_id, occurred_at desc)
--    顧客詳細ページのタイムライン + 沈黙判定の per-client 取得を高速化
--
-- 2) referrals(organization_id, job_posting_id)
--    マッチング画面で「特定求人に応募済みの顧客」を取得する経路を高速化
-- =====================================================================

create index if not exists ci_client_occurred_idx
  on public.client_interactions (client_record_id, occurred_at desc);

create index if not exists referrals_org_job_idx
  on public.referrals (organization_id, job_posting_id);
