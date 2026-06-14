-- ============================================
-- 求人テーブル拡張(EMPRO 調査 + 2024年改正労基法対応)
--
-- 現状の job_postings は MVP の最小列構成(12列程度)。
-- EMPRO 調査結果(51列)から、Maira の業務に最も価値が高い 8 項目を選んで追加する。
-- すべて NULL 許容で既存データを壊さない。
--
-- 追加理由:
--   1. work_change_scope          2024年改正労基法で必須化された「業務内容(変更の範囲)」
--   2. location_change_scope      同改正の「就業場所(変更の範囲)」
--   3. smoking_prevention_measure 健康増進法に基づく「受動喫煙防止措置」必須開示
--   4. probation_period           試用期間(エージェント業務で頻出の確認項目)
--   5. work_hours                 勤務時間(法定明示事項)
--   6. break_time                 休憩時間(法定明示事項)
--   7. holidays                   休日休暇(法定明示事項)
--   8. application_qualifications 応募資格(求人マッチングの中核情報)
--
-- 暗号化はしない(求人情報は公開前提のため平文 OK)。
-- 既存の RLS ポリシー(2026-05-31 マイグレーション)は ALTER 後も継続して有効。
-- ============================================

alter table public.job_postings
  add column if not exists work_change_scope text,
  add column if not exists location_change_scope text,
  add column if not exists smoking_prevention_measure text,
  add column if not exists probation_period text,
  add column if not exists work_hours text,
  add column if not exists break_time text,
  add column if not exists holidays text,
  add column if not exists application_qualifications text;

comment on column public.job_postings.work_change_scope is
  '業務内容(変更の範囲)。2024年改正労基法で必須化された明示事項。';
comment on column public.job_postings.location_change_scope is
  '就業場所(変更の範囲)。2024年改正労基法で必須化された明示事項。';
comment on column public.job_postings.smoking_prevention_measure is
  '受動喫煙防止措置(例:屋内禁煙 / 屋内全面禁煙 / 喫煙室設置 など)。健康増進法で開示必須。';
comment on column public.job_postings.probation_period is
  '試用期間(例:「3か月、給与・待遇に変更なし」)';
comment on column public.job_postings.work_hours is
  '勤務時間(例:「9:00-18:00、休憩1時間」)';
comment on column public.job_postings.break_time is
  '休憩時間(例:「60分」)';
comment on column public.job_postings.holidays is
  '休日休暇(例:「完全週休2日、土日祝、GW、夏季、年末年始」)';
comment on column public.job_postings.application_qualifications is
  '応募資格(例:「Webアプリ開発経験3年以上」)';
