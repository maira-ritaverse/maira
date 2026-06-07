-- ============================================
-- 開示フロー Phase 4:エージェントの linked クライアント書類閲覧 RLS
--   + 求職者の招待元/連携先 organizations 限定 SELECT RLS
--
-- 背景:
--   Phase 1 で career_profile 全体開放ポリシーを撤去し、書類(resumes / cvs)を
--   linked クライアント単位で限定開示する方針に転換した。本マイグレーションで
--   その「開示の入口」となる 3 ポリシーを追加する。書き込み権限(INSERT / UPDATE /
--   DELETE)は本人限定の既存ポリシーのまま無変更。
--
--   また、Phase 3 の /app/connections は「組織名表示は後続 Phase」としていた
--   持ち越しをここで回収する。求職者が自分が当事者である client_records 行に
--   紐づく organizations のみ name を select できる限定ポリシーを追加する。
--
-- セキュリティ設計:
--   - resumes / cvs ポリシーは、linked かつ自組織を厳密に AND で結ぶ。
--     linked_user_id IS NULL の行(まだ承認されていない invited / 履歴のない
--     unlinked)は SELECT サブクエリから除外され開示されない。
--   - 同じサブクエリ書式は、Phase 1 で撤去した
--     20260601000003_agency_view_linked_client_career_profile.sql の書き方を
--     踏襲(career_profile から書類対象に置き換えただけ)。
--   - organizations 追加ポリシーは、求職者の本人 SELECT 経路(client_records の
--     invited メール一致 / linked|revoked の linked_user_id 一致)で見える行に
--     対応する organizations のみを開放。既存ポリシーは無変更で OR 合成。
-- ============================================

-- ============================================
-- A1. resumes:linked かつ自組織のクライアントのみエージェント SELECT 可
-- ============================================
create policy "Org members can view linked client resumes"
  on public.resumes for select
  using (
    user_id in (
      select linked_user_id from public.client_records
      where linked_user_id is not null
        and link_status = 'linked'
        and organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
        )
    )
  );

comment on policy "Org members can view linked client resumes" on public.resumes is
  '開示フロー Phase 4。linked 状態の自組織クライアントの履歴書のみ select 可。'
  'INSERT/UPDATE/DELETE は本人限定の既存ポリシーで不変。';

-- ============================================
-- A2. cvs:linked かつ自組織のクライアントのみエージェント SELECT 可
-- ============================================
create policy "Org members can view linked client cvs"
  on public.cvs for select
  using (
    user_id in (
      select linked_user_id from public.client_records
      where linked_user_id is not null
        and link_status = 'linked'
        and organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
        )
    )
  );

comment on policy "Org members can view linked client cvs" on public.cvs is
  '開示フロー Phase 4。linked 状態の自組織クライアントの職務経歴書のみ select 可。'
  'INSERT/UPDATE/DELETE は本人限定の既存ポリシーで不変。';

-- ============================================
-- B. organizations:求職者は自分が当事者の client_records 行に紐づく organization
--   のみ SELECT 可。既存 "Members can view their own organization"(自組織員)
--   ポリシーには手を入れず、OR 合成される追加ポリシーとして導入する。
--
-- 「当事者」の定義:
--   - 招待された:client_records.link_status = 'invited' かつ
--     lower(trim(client_records.email)) = current_user_email()
--   - 連携した/解除した:client_records.linked_user_id = auth.uid() かつ
--     link_status in ('linked','revoked')
--   この 2 つは Phase 2/3 の「本人向け SELECT ポリシー」と同じ条件を踏襲。
--   求職者から見える client_records 行に対応する organization のみが開放される。
-- ============================================
create policy "Seeker can view organizations they are connected with"
  on public.organizations for select
  using (
    id in (
      select organization_id from public.client_records
      where (
        link_status = 'invited'
        and lower(trim(email)) = public.current_user_email()
      ) or (
        linked_user_id = auth.uid()
        and link_status in ('linked', 'revoked')
      )
    )
  );

comment on policy "Seeker can view organizations they are connected with" on public.organizations is
  '開示フロー Phase 4。求職者が、招待を受けた(メール一致 invited)または '
  '連携した/解除した(linked_user_id 一致 linked|revoked)client_records 行に '
  '紐づく organization のみ select 可。組織員向けの既存ポリシーは無変更で OR 合成。';
