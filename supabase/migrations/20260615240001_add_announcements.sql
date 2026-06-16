-- =====================================================================
-- 組織内お知らせ(announcements / announcement_reads)
--
-- admin が組織メンバー全員に向けて投稿できるお知らせ。
-- 既読管理:announcement_reads(member_id, announcement_id, read_at)。
-- ダッシュボードに「未読 N 件」バッジを出す。
-- =====================================================================

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) > 0 and length(title) <= 200),
  body text not null check (length(body) > 0 and length(body) <= 5000),
  -- pinned:重要なお知らせを常に上に表示する
  is_pinned boolean not null default false,
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ann_org_created_idx
  on public.announcements (organization_id, is_pinned desc, created_at desc);

drop trigger if exists set_announcements_updated_at on public.announcements;
create trigger set_announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

comment on table public.announcements is '組織内お知らせ(admin 投稿、メンバー閲覧)';

-- 既読:メンバー × お知らせ
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  member_id uuid not null references public.organization_members(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, member_id)
);

create index if not exists ar_member_idx on public.announcement_reads (member_id);

-- ===========================
-- RLS
-- ===========================
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

-- SELECT:同組織メンバー
drop policy if exists "Org members can view announcements" on public.announcements;
create policy "Org members can view announcements"
  on public.announcements for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE:admin のみ
drop policy if exists "Admins can insert announcements" on public.announcements;
create policy "Admins can insert announcements"
  on public.announcements for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can update announcements" on public.announcements;
create policy "Admins can update announcements"
  on public.announcements for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop policy if exists "Admins can delete announcements" on public.announcements;
create policy "Admins can delete announcements"
  on public.announcements for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- announcement_reads:本人のみ操作可
drop policy if exists "Members can manage own reads" on public.announcement_reads;
create policy "Members can manage own reads"
  on public.announcement_reads for all
  using (
    exists (
      select 1 from public.organization_members om
      where om.id = member_id and om.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.organization_members om
      where om.id = member_id and om.user_id = auth.uid()
    )
  );
