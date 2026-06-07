-- ============================================
-- 開示フロー Phase 3 サブパッチ:revoked 行の本人 SELECT ポリシー追加
--
-- 背景:
--   Phase 2 で実装した revoke_client_link RPC は「履歴として残す」設計で、
--   linked_user_id をクリアせず link_status='revoked' / revoked_at=now() を
--   立てる。一方、既存の Linked seeker ポリシー
--   (20260531000001_add_client_records.sql)は link_status='linked' を要求して
--   おり、結果として「本人が解除した直後から自分の解除済み連携を見られない」
--   状態になっていた。
--
--   Phase 3 の /app/connections は「解除済みの連携を履歴として薄く表示」する
--   仕様だが、現状 RLS だと revoked セクションが常に空になり機能要件が満たせない。
--
-- 対応:
--   既存 Linked seeker ポリシーには手を入れず、revoked 行用の本人 SELECT ポリシーを
--   別途追加する(複数 SELECT ポリシーは OR 合成されるため、Linked seeker と
--   Invited seeker の挙動には一切影響しない)。
--
-- セキュリティ設計:
--   - 条件は linked_user_id = auth.uid() AND link_status = 'revoked'。
--     一度も linked に到達していない行(unlinked / invited のみを経た行)は
--     linked_user_id が null のままなので本ポリシーには引っかからない。
--   - revoked 行は履歴として本人にのみ可視。エージェント側は organization 一致の
--     既存メンバー SELECT ポリシーでこれまで通り全行見える(organization 内の
--     業務管理は本ポリシーの影響範囲外)。
--   - 列レベル制約はないので、notes 含め全列が本人に見えるが、UI(/app/connections)
--     側は connection 型で必要列のみに絞っている(lib/connections/queries.ts)。
-- ============================================

create policy "Revoked seeker can view their own client record"
  on public.client_records for select
  using (
    linked_user_id = auth.uid()
    and link_status = 'revoked'
  );
