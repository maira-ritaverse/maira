-- ============================================
-- 新着・更新バッジ機能(案B:メンバー個人単位)P1:
--   client_view_states テーブル新設
--
-- 背景:
--   linked クライアントの本人データ(career_profile / resumes / cvs)は参照方式で
--   常に最新が見えるが、エージェントが「自分が前回見て以降に更新があったか」を
--   判別する手段が無く、一覧から能動的に新着を拾えない。
--   メンバー個人 × クライアント単位で「最後にクライアント詳細を見た時刻」を
--   持ち、本人データ各テーブルの updated_at と比較してバッジ判定する。
--
-- 設計判断:
--   - キーは organization_members.id ではなく user_id(= auth.uid())。
--     理由:RLS が user_id = auth.uid() の素直な等価で書け、lookup なしで完結。
--     organization_members は (user_id) UNIQUE なので member 1 対 1 で問題なし。
--   - organization_id を冗長に持つ。
--     理由:client_records への join なしで RLS を完結させたい。
--     アプリ層は client_records.organization_id を取り直して upsert する責務を持つ。
--   - PK は (user_id, client_record_id)。同一メンバーが同一クライアントを複数回
--     見ても 1 行(上書き)で十分。
--   - 自テーブル参照なし(無限再帰の懸念なし)。RLS は current_user_organization_id()
--     SECURITY DEFINER ヘルパー(20260531000002 で導入済)を流用。
-- ============================================

create table if not exists public.client_view_states (
  user_id          uuid not null references auth.users(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  -- RLS で「自組織のクライアント記録についての閲覧記録のみ」を強制するための冗長列。
  -- client_records への join を避けて RLS を完結させる(性能・可読性)。
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  last_viewed_at   timestamptz not null default now(),
  primary key (user_id, client_record_id)
);

comment on table public.client_view_states is
  '新着・更新バッジ用。メンバー個人(user_id)× クライアント(client_record_id)単位で'
  '「最後にクライアント詳細を見た時刻」を持つ。本人データの updated_at と比較してバッジ判定する。';
comment on column public.client_view_states.organization_id is
  'RLS で自組織のみを強制するための冗長列(client_records への join 回避)。'
  '書き込み時にアプリ層が client_records.organization_id を取り直して upsert する責務を持つ。';
comment on column public.client_view_states.last_viewed_at is
  'クライアント詳細画面を開いた時刻。upsert で上書きされる。';

-- 一覧表示時に「user_id = auth.uid() and client_record_id in (...)」を引くための索引。
-- PK が (user_id, client_record_id) なので主にこの順アクセスで十分だが、
-- in(...) の探索を効かせる別索引を明示する(PK と等価でも create index で重複は出ない)。
create index if not exists idx_client_view_states_user_client
  on public.client_view_states(user_id, client_record_id);

-- 組織スコープでの監査やデバッグで叩く可能性に備える。
create index if not exists idx_client_view_states_org
  on public.client_view_states(organization_id);

-- ============================================
-- RLS:自分(auth.uid)の閲覧記録のみ、かつ自組織スコープ
--
-- AND で organization_id = current_user_organization_id() を絞ることで、
-- 仮にアプリ層が他組織の organization_id を入れて upsert を試みても弾く。
-- 自テーブル参照なしの素直な比較なので、無限再帰の懸念は無い。
-- ============================================
alter table public.client_view_states enable row level security;

create policy "Users can view their own client view states"
  on public.client_view_states for select
  using (
    user_id = auth.uid()
    and organization_id = public.current_user_organization_id()
  );

create policy "Users can insert their own client view states"
  on public.client_view_states for insert
  with check (
    user_id = auth.uid()
    and organization_id = public.current_user_organization_id()
  );

create policy "Users can update their own client view states"
  on public.client_view_states for update
  using (
    user_id = auth.uid()
    and organization_id = public.current_user_organization_id()
  )
  with check (
    user_id = auth.uid()
    and organization_id = public.current_user_organization_id()
  );

comment on policy "Users can view their own client view states" on public.client_view_states is
  '自分(user_id = auth.uid)の閲覧記録のみ select 可。自組織との AND で他組織なりすまし防止。';
comment on policy "Users can insert their own client view states" on public.client_view_states is
  '自分(user_id = auth.uid)の閲覧記録のみ insert 可。自組織との AND で他組織なりすまし防止。';
comment on policy "Users can update their own client view states" on public.client_view_states is
  '自分(user_id = auth.uid)の閲覧記録のみ update 可。自組織との AND で他組織なりすまし防止。'
  'upsert(on conflict do update)用に update ポリシーも必要。';

-- DELETE は意図的に持たない:
--   本機能では「上書きで最新化」だけが必要で、ユーザー操作で削除する経路は無い。
--   レコード削除は client_records / auth.users の cascade に任せる。
