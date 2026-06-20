-- ============================================
-- 面談 / 面接 ログ (interviews) + client_records.birthday
--
-- 目的:
--   MA シナリオ 5 件 (meeting_reminder / job_introduction /
--   after_interview_followup / post_placement_followup / birthday_greeting)
--   の 判定 ロジック を 動作 させる ため の 前提 データ。
--
-- 設計:
--   ・interviews は referrals に 紐づく (1 referral に N 件 の 面談)
--   ・kind = first / second / final / offer / company (柔軟性 の ため text + CHECK)
--   ・result は scheduled / done / canceled / no_show
--   ・notes は エージェント の メモ。 機密 情報 を 含む 可能性 が ある ので
--     現状 は 平文 text (将来 暗号化 への 拡張 余地 あり)
-- ============================================

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  referral_id uuid not null
    references public.referrals(id) on delete cascade,

  kind text not null check (kind in ('first', 'second', 'final', 'offer', 'company')),
  scheduled_at timestamptz not null,
  result text not null default 'scheduled'
    check (result in ('scheduled', 'done', 'canceled', 'no_show')),
  notes text,

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.interviews is
  '面談 / 面接 ログ。 referrals に 紐づく N 件 の 面談 イベント。 MA シナリオ の 判定 軸 として 使用。';
comment on column public.interviews.kind is
  'first=1次 / second=2次 / final=最終 / offer=内定面談 / company=企業面談';
comment on column public.interviews.result is
  'scheduled=予定 / done=実施 / canceled=中止 / no_show=不参加';

create index if not exists idx_interviews_org_scheduled
  on public.interviews (organization_id, scheduled_at desc);
create index if not exists idx_interviews_referral
  on public.interviews (referral_id, scheduled_at desc);
create index if not exists idx_interviews_scheduled
  on public.interviews (scheduled_at)
  where result = 'scheduled';

-- updated_at trigger
drop trigger if exists set_interviews_updated_at on public.interviews;
create trigger set_interviews_updated_at
  before update on public.interviews
  for each row execute function public.set_updated_at();

-- RLS:同 org メンバー の み 閲覧 / 編集 可
alter table public.interviews enable row level security;

drop policy if exists iv_select on public.interviews;
create policy iv_select on public.interviews for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists iv_insert on public.interviews;
create policy iv_insert on public.interviews for insert
  with check (organization_id = public.current_user_organization_id());

drop policy if exists iv_update on public.interviews;
create policy iv_update on public.interviews for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists iv_delete on public.interviews;
create policy iv_delete on public.interviews for delete
  using (organization_id = public.current_user_organization_id());

-- ============================================
-- client_records.birthday (誕生日 シナリオ 用)
--
-- 平文 DATE で 保存。 年 月 日 を 厳密 に 持つ ため text では なく DATE 型。
-- ============================================
alter table public.client_records
  add column if not exists birthday date;

comment on column public.client_records.birthday is
  '誕生日 (年 月 日)。 birthday_greeting シナリオ で 「今日 が 誕生日 の 求職者」を 抽出。';

-- 月日 だけ で 抽出 する ため の expression index
create index if not exists idx_client_records_birthday_mmdd
  on public.client_records (
    extract(month from birthday),
    extract(day from birthday)
  )
  where birthday is not null;
