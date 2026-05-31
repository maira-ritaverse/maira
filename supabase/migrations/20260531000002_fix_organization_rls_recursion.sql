-- ============================================
-- organizations 系 RLS の無限再帰修正
--
-- 背景:
--   20260530000001 で作った organization_members の RLS ポリシーは、
--   USING 句のサブクエリで organization_members 自身を SELECT していた:
--
--     using (
--       organization_id in (
--         select organization_id from organization_members where user_id = auth.uid()
--       )
--     )
--
--   この policy を評価するために organization_members を読みに行くと、
--   再び同じ policy が評価され、Postgres が再帰を検知して 42P17 で 0 件に倒れる。
--   結果として getUserRole が常に seeker を返してしまっていた。
--
-- 対策:
--   SECURITY DEFINER 関数で「現在ユーザーの所属組織ID/ロール」を RLS バイパスで
--   取り出し、policy はその結果値と比較するだけにする(再帰しない)。
--
-- 意図(テナント分離強度)は完全に維持:
--   - 別企業のデータは一切見せない
--   - admin 権限の緩和なし
--   - 求職者の linked 行閲覧ポリシーは触らない
-- ============================================

-- ============================================
-- 1. SECURITY DEFINER ヘルパー関数
-- ============================================
-- なぜ SECURITY DEFINER:
--   関数所有者(postgres)権限で実行されるため RLS をバイパスできる。
--   ただし内部で auth.uid() に紐づく自分の1行しか取り出さないので、
--   呼び出し元が他人のデータを得ることはできない。
--
-- なぜ stable:
--   同一クエリ内では auth.uid() の値も organization_members の内容も変わらないため、
--   stable とすることでプランナーが結果をキャッシュでき性能が出る。

create or replace function public.current_user_organization_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;
$$;

comment on function public.current_user_organization_id() is
  'RLS 再帰回避用。現在の認証ユーザーが所属する企業の id を返す(なければ null)。';

create or replace function public.current_user_organization_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.organization_members
  where user_id = auth.uid()
  limit 1;
$$;

comment on function public.current_user_organization_role() is
  'RLS 再帰回避用。現在の認証ユーザーの組織内ロール(admin / advisor)を返す(なければ null)。';

-- ============================================
-- 2. organization_members の policy 置き換え
-- ============================================
-- 再帰している既存4つの policy を消し、関数ベースで作り直す。
-- 「自分のメンバー行を直接読みたい」ケース(getUserRole の主用途)も、
--   organization_id = current_user_organization_id() で自然に通る。

drop policy if exists "Members can view members in same organization" on public.organization_members;
drop policy if exists "Admins can insert members in their organization" on public.organization_members;
drop policy if exists "Admins can update members in their organization" on public.organization_members;
drop policy if exists "Admins can delete members in their organization" on public.organization_members;

create policy "Members can view members in same organization"
  on public.organization_members for select
  using (organization_id = public.current_user_organization_id());

create policy "Admins can insert members in their organization"
  on public.organization_members for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "Admins can update members in their organization"
  on public.organization_members for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

create policy "Admins can delete members in their organization"
  on public.organization_members for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ============================================
-- 3. organizations の policy 置き換え
-- ============================================
-- 既存はサブクエリで organization_members を参照していたため、
-- organization_members 側の再帰の巻き添えで詰まっていた。

drop policy if exists "Members can view their own organization" on public.organizations;
drop policy if exists "Admins can update their own organization" on public.organizations;

create policy "Members can view their own organization"
  on public.organizations for select
  using (id = public.current_user_organization_id());

create policy "Admins can update their own organization"
  on public.organizations for update
  using (
    id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ============================================
-- 4. client_records の policy 置き換え
-- ============================================
-- Phase 2-A で追加された policy も organization_members を参照していたため、
-- 巻き添えで詰まっていた。意図は同一のまま関数ベースに揃える。
-- なお「紐づいた求職者本人の閲覧 policy」(Linked seeker can view ...)は
-- 自テーブル列の比較のみで再帰しないため変更しない。

drop policy if exists "Members can view client records in their organization" on public.client_records;
drop policy if exists "Members can insert client records in their organization" on public.client_records;
drop policy if exists "Members can update client records in their organization" on public.client_records;
drop policy if exists "Admins can delete client records in their organization" on public.client_records;

create policy "Members can view client records in their organization"
  on public.client_records for select
  using (organization_id = public.current_user_organization_id());

create policy "Members can insert client records in their organization"
  on public.client_records for insert
  with check (organization_id = public.current_user_organization_id());

create policy "Members can update client records in their organization"
  on public.client_records for update
  using (organization_id = public.current_user_organization_id());

create policy "Admins can delete client records in their organization"
  on public.client_records for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
