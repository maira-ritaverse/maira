-- ============================================
-- ma_send_logs: admin INSERT ポリシー追加
--
-- ma_send_logs は Phase C-3 で「service_role(Edge Function)のみ書き込み可」
-- として作成したが、Web 側の「テスト送信機能」(Step B)から admin が
-- 1 通単位でテストメールを送って同じ表に記録したい需要が出た。
--
-- 対応:admin の INSERT を許可する RLS ポリシーを追加する。
--   - cron 経由の本配信は引き続き service_role 経由(ポリシー関係なくバイパス)
--   - 自組織のレコードのみ insert 可能(他組織への混入を物理的に防止)
-- ============================================

create policy msl_admin_insert
  on public.ma_send_logs for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
