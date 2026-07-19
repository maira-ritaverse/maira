-- =====================================================================
-- created_by_member_id カラム 追加 (Phase A: actor 追跡 の 空白 埋め)
--
-- 背景:
--   将来設計 (Phase 2 CA 個人 信頼スコア) の 前提 として、 全 history / event
--   系 テーブル に 「誰 (どの organization_member) が 実行 したか」 を 記録 する
--   必要 が ある。 今回 は 現状 「actor カラム が 存在 しない」 3 テーブル に
--   対して、 nullable + on delete set null で カラム を 追加。
--
--   ・referrals (応募): 「planned で 止まった 応募」 の 起票者 が 追跡 不能
--                       だった → Phase 2 の 応募起票貢献 集計 に 必要
--   ・client_records (求職者): 現状 assigned_member_id (=担当) しか なく、
--                              「誰 が 新規登録 したか」 を 復元 できない →
--                              Phase 2 の データ 品質 スコア に 必要
--   ・agency_tasks (タスク): assigned_member_id (=タスク 受け取り 側) しか
--                            なく、 「他人 に タスク を 振った 側」 が
--                            追えない → チーム リード 行動 の 評価 に 必要
--
-- 影響:
--   ・全 カラム が nullable な ので 既存 データ / 既存 API に は 影響 なし
--   ・on delete set null なので member 物理削除 (soft delete 化 が 未実装 の
--     現状) でも 履歴 は 残る
--   ・アプリ 側 は 別 コミット で INSERT 時 に role.member.id を 注入 する
--     ように 修正 (このマイグレーション 単独 で は 挙動 変化 なし)
--
-- 適用:
--   dev / prod 共 に Supabase Dashboard の SQL Editor から 手動 適用
--   (SUPABASE_DB_PASSWORD 未設定 の 現行 運用)。
-- =====================================================================

-- ── referrals: 応募 起票者
alter table public.referrals
  add column if not exists created_by_member_id uuid
    references public.organization_members(id) on delete set null;

comment on column public.referrals.created_by_member_id is
  '応募 を 起票 した organization_member。 Phase 2 信頼スコア の 応募起票貢献 で 使用。 member 削除 (物理) 時 は set null で 履歴 のみ 残る。';

create index if not exists idx_referrals_created_by_member_id
  on public.referrals (created_by_member_id)
  where created_by_member_id is not null;


-- ── client_records: 求職者 新規登録者
alter table public.client_records
  add column if not exists created_by_member_id uuid
    references public.organization_members(id) on delete set null;

comment on column public.client_records.created_by_member_id is
  '求職者 を 新規 登録 した organization_member。 assigned_member_id (=現在 の 担当) と 別物 で、 変更 しない。 Phase 2 の データ 品質 スコア 集計 に 使用。 public intake form 経由 の セルフ 登録 は null。';

create index if not exists idx_client_records_created_by_member_id
  on public.client_records (created_by_member_id)
  where created_by_member_id is not null;


-- ── agency_tasks: タスク delegator (誰 が 振った か)
alter table public.agency_tasks
  add column if not exists created_by_member_id uuid
    references public.organization_members(id) on delete set null;

comment on column public.agency_tasks.created_by_member_id is
  'タスク を 作成 (delegator = 振る側) した organization_member。 assigned_member_id (=タスク 受け取り 側) と 別物。 チーム リード 行動 の 評価 に 使用。';

create index if not exists idx_agency_tasks_created_by_member_id
  on public.agency_tasks (created_by_member_id)
  where created_by_member_id is not null;
