-- =====================================================================
-- M2: client_records の UPDATE を team-scope に揃える
--
-- 背景(監査 M2):
--   SELECT は 20260709000012 の cr_select_team_scoped で team 分離済み(admin /
--   未割当 pool / 同 team / 主担当 のいずれかのみ可視)。一方 UPDATE ポリシーは
--   20260531000002 のまま org 全体
--     using (organization_id = public.current_user_organization_id())
--   で、team 分離を有効化した組織でも、advisor が「見えない」他 team の顧客の
--   client_records を uuid 指定で UPDATE(notes 等の改ざん)できてしまう。
--   越境(他組織)漏洩ではなく組織内の team 越え改ざん。
--
-- 対策:
--   UPDATE の USING を cr_select_team_scoped と同一の team 述語にし、「SELECT
--   できる行だけ UPDATE できる」に揃える。WITH CHECK は従来どおり org スコープに
--   留め(更新後も自組織内であることだけを要求)、正規のフィールド更新を壊さない。
--
--   ※ 述語は SELECT ポリシーからの複製(RLS ポリシーは相互参照できないため)。
--     cr_select_team_scoped を変更する際は本ポリシーも合わせて更新すること。
--   ※ 外側の organization_id = current_user_organization_id() が removed_at 済
--     メンバーを弾くため、本ポリシーはオフボーディングにも安全。
-- =====================================================================

drop policy if exists "Members can update client records in their organization"
  on public.client_records;

create policy "Members can update client records in their organization"
  on public.client_records for update
  using (
    organization_id = public.current_user_organization_id()
    and (
      -- (a) 組織 admin は 全 顧客 可
      exists (
        select 1 from public.organization_members om
        where om.user_id = auth.uid()
          and om.organization_id = public.client_records.organization_id
          and om.role = 'admin'
      )
      -- (b) 顧客 が どの team にも 未 割当
      or not exists (
        select 1 from public.client_team_assignments cta
        where cta.client_record_id = public.client_records.id
      )
      -- (c) 顧客 の 所属 team に 呼び 出し 者 も 所属
      or exists (
        select 1
        from public.client_team_assignments cta
        join public.organization_team_members otm on otm.team_id = cta.team_id
        join public.organization_members om on om.id = otm.member_id
        where cta.client_record_id = public.client_records.id
          and om.user_id = auth.uid()
      )
      -- (d) 呼び出し者が client の 主担当
      or (
        public.client_records.assigned_member_id is not null
        and exists (
          select 1 from public.organization_members om
          where om.id = public.client_records.assigned_member_id
            and om.user_id = auth.uid()
        )
      )
    )
  )
  with check (organization_id = public.current_user_organization_id());

comment on policy "Members can update client records in their organization" on public.client_records is
  'team 分離対応の UPDATE ポリシー(M2 修正)。SELECT(cr_select_team_scoped)と同じ '
  'team 述語で「見える顧客だけ更新可」に揃える。WITH CHECK は自組織スコープ維持。';
