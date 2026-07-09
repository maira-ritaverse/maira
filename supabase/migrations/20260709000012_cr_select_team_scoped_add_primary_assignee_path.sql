-- =====================================================================
-- client_records の team scope SELECT policy を拡張
--
-- 背景:
--   organization_team_members の member_id が member 削除で cascade 消去され、
--   割当済 client を持つ team の member が 0 名 になると、その team に属する
--   client は admin 以外から不可視になる (path a のみで救済)。 主担当 (assigned_
--   member_id) は業務上 その client の責任者なので、常時可視である必要がある。
--
-- 修正:
--   経路 (d) を追加: 呼び出し者が client の主担当 (assigned_member_id) の場合、
--   team 分離とは無関係に常に可視。 副担当 (collaborators) は別途 対応が必要な
--   ので今回は含めない (影響範囲を最小化)。
--
-- 副作用:
--   - team 分離を有効化した組織でも、主担当は自分の担当 client を team 越しに
--     見ることができる。これは業務上望ましい挙動 (担当者は自分の client を
--     見失うべきでない)。
--   - 逆に「主担当を別 team のメンバーに変更 = その担当者にも見せる」というのは
--     現状の運用 (主担当変更 は 明示的操作) を前提として許容する。
-- =====================================================================

drop policy if exists "cr_select_team_scoped" on public.client_records;

create policy "cr_select_team_scoped"
  on public.client_records for select
  using (
    organization_id = public.current_user_organization_id()
    and (
      -- (a) 組織 admin は 全 顧客 可視
      exists (
        select 1 from public.organization_members om
        where om.user_id = auth.uid()
          and om.organization_id = public.client_records.organization_id
          and om.role = 'admin'
      )
      -- (b) 顧客 が どの team にも 未 割当 (段階 移行 の 中 で 従来 動作 を 維持)
      or not exists (
        select 1 from public.client_team_assignments cta
        where cta.client_record_id = public.client_records.id
      )
      -- (c) 顧客 の 所属 team に 呼び 出し 者 も 所属 (完全 分離 の 本体)
      or exists (
        select 1
        from public.client_team_assignments cta
        join public.organization_team_members otm on otm.team_id = cta.team_id
        join public.organization_members om on om.id = otm.member_id
        where cta.client_record_id = public.client_records.id
          and om.user_id = auth.uid()
      )
      -- (d) 呼び出し者が client の 主担当 (orphan team の可視性救済)
      or (
        public.client_records.assigned_member_id is not null
        and exists (
          select 1 from public.organization_members om
          where om.id = public.client_records.assigned_member_id
            and om.user_id = auth.uid()
        )
      )
    )
  );

comment on policy "cr_select_team_scoped" on public.client_records is
  'team 分離対応の SELECT ポリシー。 admin / 未割当 pool / team 共有 / 主担当 '
  'のいずれかで可視 (2026-07-09 追加 経路 (d): 主担当の team 越し可視)。';
