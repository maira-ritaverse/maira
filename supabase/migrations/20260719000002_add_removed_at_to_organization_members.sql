-- =====================================================================
-- organization_members に removed_at カラム 追加 (Phase A #1 / Step 1)
--
-- 目的:
--   将来設計 (Phase 2: CA 個人 の レピュテーション 持ち運び) の 前提。
--   現状 は member 削除 で cascade で 全 履歴 が 消える 構造 の ため、
--   soft delete に 切替 て 「member を 辞めた 後 も 過去 実績 が 残る」 状態
--   を 実現 する。
--
-- 適用 順序 (今回 は Step 1 のみ):
--   ・Step 1 (本 migration): removed_at カラム 追加、 partial index 準備
--     → backward compatible、 挙動 変化 なし
--   ・Step 2 (別 コミット): TS/API 側 に .is("removed_at", null) フィルタ 追加
--     → まだ RLS も RPC も 変わって いない ので 挙動 変化 なし
--   ・Step 3 (別 migration = 20260719000003): RLS helper 2 個 + policies 4 個
--     + RPCs (accept_invitation / deactivate_member / 他 10 個) + unique 制約 の
--     partial index 化 を 一括 で 切替。 この 時点 で soft delete が 発動 する
--
-- 影響:
--   ・カラム 追加 のみ。 全 行 は removed_at = NULL で 挿入 (=現役 扱い)。
--   ・既存 SELECT / RLS / RPC に は 影響 なし (フィルタ 追加 は Step 2/3 で)。
--   ・cascade 経路 は 触ら ない (Step 3 で 検討)。
--
-- 適用:
--   dev / prod 共 に Supabase Dashboard の SQL Editor から 手動 適用。
-- =====================================================================

alter table public.organization_members
  add column if not exists removed_at timestamptz null;

comment on column public.organization_members.removed_at is
  'メンバー が 組織 から 除外 され た 時刻。 NULL = 現役、 非 NULL = 除外済み。 Phase A #1 で 導入。 通常 の SELECT / RLS ポリシー で は WHERE removed_at IS NULL で 絞る こと (Step 3 で helper 関数 と policies に 反映)。 過去 実績 集計 (get_referral_kpi_by_member 等) は 意図的 に フィルタ せず 除外済 メンバー も 含める。';

-- partial index: WHERE removed_at IS NULL の 検索 を 高速化。
-- Step 3 で unique (user_id) を partial unique に 置換 する 準備 も 兼ね る。
create index if not exists idx_organization_members_active_user_id
  on public.organization_members (user_id)
  where removed_at is null;

create index if not exists idx_organization_members_active_org_id
  on public.organization_members (organization_id)
  where removed_at is null;
