-- ============================================
-- クライアントレコード(企業所有)
--
-- エージェント企業が管理するクライアント情報。
-- 求職者本人のMairaアカウントとは別物(ハイブリッド設計)。
-- メール一致 + 求職者オプトインで紐づく。
-- ============================================

create table if not exists public.client_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- 担当アドバイザー(organization_members への参照)
  assigned_member_id uuid references public.organization_members(id) on delete set null,

  -- 企業が記録する基本情報(求職者アカウントとは独立)
  name text not null,
  email text not null,
  phone text,

  -- エージェント業務の進捗ステータス
  status text not null default 'initial_meeting'
    check (status in (
      'initial_meeting', 'job_matching', 'in_screening',
      'offer', 'completed', 'declined'
    )),

  -- 紐づけ状態
  link_status text not null default 'unlinked'
    check (link_status in ('unlinked', 'invited', 'linked', 'revoked')),

  -- 紐づいた求職者の user_id(linked時のみ非null)
  linked_user_id uuid references auth.users(id) on delete set null,
  linked_at timestamptz,
  revoked_at timestamptz,

  -- 企業メモ(アドバイザーの自由記述)
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.client_records is 'エージェント企業が管理するクライアント情報(企業所有、求職者アカウントとは別)';
comment on column public.client_records.link_status is 'unlinked/invited/linked/revoked';
comment on column public.client_records.linked_user_id is '紐づいた求職者のuser_id(linked時のみ)';

create index if not exists idx_client_records_org_id on public.client_records(organization_id);
create index if not exists idx_client_records_assigned on public.client_records(assigned_member_id);
create index if not exists idx_client_records_email on public.client_records(email);
create index if not exists idx_client_records_linked_user on public.client_records(linked_user_id);

alter table public.client_records enable row level security;

-- ============================================
-- RLS ポリシー
-- ============================================

-- 閲覧:同じ企業のメンバーは、自社のクライアントレコードを見られる
create policy "Members can view client records in their organization"
  on public.client_records for select
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- 追加:同じ企業のメンバーは、自社にクライアントを登録できる
create policy "Members can insert client records in their organization"
  on public.client_records for insert
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- 更新:同じ企業のメンバーは、自社のクライアントレコードを更新できる
create policy "Members can update client records in their organization"
  on public.client_records for update
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- 削除:管理者のみ、自社のクライアントレコードを削除できる
create policy "Admins can delete client records in their organization"
  on public.client_records for delete
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
        and role = 'admin'
    )
  );

-- ============================================
-- 紐づいた求職者本人も、自分に紐づくクライアントレコードを
-- 「閲覧」できる(紐づけ解除の判断のため)
-- ※更新・削除はできない(企業所有データなので)
-- ============================================
create policy "Linked seeker can view their own client record"
  on public.client_records for select
  using (
    linked_user_id = auth.uid()
    and link_status = 'linked'
  );

-- ============================================
-- updated_at トリガー
-- (set_updated_at 関数は Phase 1 で作成済み)
-- ============================================
drop trigger if exists set_client_records_updated_at on public.client_records;
create trigger set_client_records_updated_at
  before update on public.client_records
  for each row execute function public.set_updated_at();
