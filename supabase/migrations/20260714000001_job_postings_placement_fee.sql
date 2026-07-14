-- ============================================
-- 求人 に 「成約報酬」 (placement_fee) 列 を 追加
--
-- 用途:
--   ・エージェント企業 が 個別 求人 に 対して 成約時 の 報酬額 を 記録
--   ・AI 求人推薦 の 重み付け に 使う (プリセット preset に 応じて)
--
-- 単位 と 型:
--   ・salary_min / salary_max と 合わせて 「万円」 単位 の integer
--   ・nullable (未設定 の 求人 で AI 推薦 側 は fee を 考慮 しない)
--
-- 露出制御 (重要):
--   ・求職者 は job_postings を 直接 SELECT できない (RLS が organization スコープ)
--   ・求職者向け 経路 は SECURITY DEFINER RPC:
--       list_open_jobs_for_seeker / get_job_for_seeker
--     いずれ も 明示 の SELECT 列 リスト で 動作 する ため、
--     この 列 を 追加 する だけ で 求職者 側 に 漏れない (defensive)。
--   ・今後 RPC を 変更 する ときも placement_fee を 追加 しない こと。
--     エージェント企業 の 収益情報 で 求職者 の 意思決定 に 影響 させて は いけない。
-- ============================================

alter table public.job_postings
  add column if not exists placement_fee integer;

comment on column public.job_postings.placement_fee is
  '成約時 の エージェント 報酬額 (万円)。 nullable。 求職者側 には 一切 露出 しない (seeker RPC に 含めない こと)。';

-- 万円 の 上限 は salary と 揃える (0〜100000 万円 = 0〜10 億円)。
-- 負値 は 「返金 case」 を 表現 したい場合 に 使う 余地 を 残したい ところ だが、
-- 現段階 では 業務要件 が 明確 で ない ので 0 以上 に 縛る。
alter table public.job_postings
  add constraint job_postings_placement_fee_range
    check (placement_fee is null or (placement_fee >= 0 and placement_fee <= 100000));

-- 高額報酬 順 の ソート や AI 推薦 の 上位 抽出 で 使う ため index を 貼る。
-- open 求人 に 絞る の は アプリ 側 の usage で、テーブル 全体 に 昇順 index。
create index if not exists idx_job_postings_placement_fee
  on public.job_postings (organization_id, placement_fee desc nulls last);
