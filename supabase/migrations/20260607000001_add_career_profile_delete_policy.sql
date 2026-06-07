-- ============================================
-- career_profiles に DELETE の RLS ポリシーを追加する
--
-- 背景:
-- - 20260518000003_setup_rls.sql で career_profiles を含む全テーブルに
--   RLS を有効化したが、career_profiles だけ delete ポリシーが定義されておらず、
--   本人ですら自分の棚卸し結果を削除できない状態だった
--   (他テーブル: conversations / messages / applications / tasks には delete ポリシーあり)。
-- - Phase C で「棚卸し結果の削除」機能を提供するため、本人のみが自分の行を
--   削除できるポリシーを追加する。
--
-- セキュリティ設計:
-- - using (auth.uid() = user_id) で本人限定。他テーブルの delete ポリシーと同形。
-- - エージェント側の閲覧ポリシー
--   (20260601000003_agency_view_linked_client_career_profile.sql)は select のみで、
--   delete はここでも本ポリシーでも対象外(他社の career_profile を削除できない)。
-- - service_role は RLS をバイパスするので影響なし。
--
-- 影響:
-- - 削除すると同じ行内の diagnosis(キャリア診断結果)も同時に消える
--   (encrypted_data JSON に同梱されているため)。これは UI 側の警告ダイアログで
--   ユーザーに明示する。
-- - career_profile_id を参照する外部キーは 0 件(全コードベース調査済み)のため
--   孤立データは発生しない。
-- - accept_invitation RPC は career_profiles 行の存在で組織昇格を拒否するため、
--   削除すると昇格できるようになる(これは正しい挙動)。
-- ============================================

create policy "Users can delete own career profile"
  on public.career_profiles for delete
  using (auth.uid() = user_id);
