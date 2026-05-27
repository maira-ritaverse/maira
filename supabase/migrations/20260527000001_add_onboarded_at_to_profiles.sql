-- ============================================
-- profiles に onboarded_at カラムを追加
--
-- 用途:オンボーディングツアーの完了状態を記録
-- - null:未完了
-- - 値あり:完了済み(タイムスタンプ)
-- ============================================

alter table public.profiles
  add column if not exists onboarded_at timestamptz default null;

comment on column public.profiles.onboarded_at is
  'オンボーディングツアー完了日時(nullなら未完了)';

-- 既存ユーザーは「未完了」扱い(null)のままにする
-- → 次回ログイン時にツアー表示候補になる
-- ただし、Phase 2 で「既存ユーザーには表示しない」判定も検討する
