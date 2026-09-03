-- =====================================================================
-- 商談(会社)ごとの営業方針・AIへの指示
--
-- 目的:
--   会社ごとに営業のプレイブック(方針)や AI に重視してほしい観点をカスタムできるようにする。
--   ここに書いた内容を、AI の議事録生成・次アクション提案の前提として全社共通プレイブックに
--   上乗せする(その会社に特化したコーチングにする)。
--
--   平文で保持する(notes と同様。is_maira_admin 限定・検索性のため。真に機微な会話内容は
--   sales_meetings 側の暗号化列に入る)。
-- =====================================================================

alter table public.sales_prospects
  add column if not exists ai_playbook text
    check (ai_playbook is null or length(ai_playbook) <= 8000);

comment on column public.sales_prospects.ai_playbook is
  '会社ごとの営業方針・AIへの指示。AI の議事録/次アクション提案の前提に反映(全社プレイブックに上乗せ)。';
