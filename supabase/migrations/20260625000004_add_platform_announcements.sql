-- =====================================================================
-- プラットフォーム(Maira 運営)→ エージェンシーへの「お知らせ」配信
--
-- 既存の public.announcements は「組織内」(admin → メンバー)向け。
-- 本マイグレーションは別軸の「運営 → 顧客企業」の配信経路を追加する。
--
-- 機能要件(運営者がカスタムできる項目):
--   ・タイトル + 本文(text)
--   ・カテゴリ(info / maintenance / important / promotion / feature)
--   ・配信対象:'all'(全エージェント)or 'specific'(特定組織のみ)
--   ・公開期間:published_at(掲出開始)+ expires_at(掲出終了)
--   ・固定表示:is_pinned
--   ・読了確認:require_ack(チェックを押すまで dismiss できない)
--   ・CTA リンク:cta_label / cta_url(任意)
--
-- 既読状態は別表 platform_announcement_reads に保存(user 単位)。
-- =====================================================================

-- 1) Maira 管理者フラグを profiles に追加
alter table public.profiles
  add column if not exists is_maira_admin boolean not null default false;

comment on column public.profiles.is_maira_admin is
  'Maira 運営者フラグ。プラットフォームお知らせの投稿権限などに使う';

-- 2) お知らせ本体
create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,

  title text not null,
  body text not null,
  -- カテゴリ:UI 上は色分け + アイコンで使う
  category text not null default 'info'
    check (category in ('info', 'maintenance', 'important', 'promotion', 'feature')),

  -- 配信対象
  target_type text not null default 'all'
    check (target_type in ('all', 'specific')),
  -- target_type='specific' のとき、配信対象 org の id 群を保持
  target_organization_ids uuid[] not null default '{}',

  -- 公開期間
  published_at timestamptz not null default now(),
  expires_at timestamptz,

  -- UI 制御
  is_pinned boolean not null default false,
  require_ack boolean not null default false,

  -- 任意 CTA(空文字は null として扱う)
  cta_label text,
  cta_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pa_pub_pinned_idx
  on public.platform_announcements (is_pinned desc, published_at desc);
create index if not exists pa_target_specific_idx
  on public.platform_announcements using gin (target_organization_ids)
  where target_type = 'specific';

comment on table public.platform_announcements is
  'Maira 運営からエージェント企業への「お知らせ」配信(全社 / 特定社向け)';

-- 3) 既読/承認状態(user 単位)
create table if not exists public.platform_announcement_reads (
  announcement_id uuid not null
    references public.platform_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  -- require_ack=true のお知らせを承認した時刻(押すまで dismiss 不可)
  acknowledged_at timestamptz,
  primary key (announcement_id, user_id)
);

comment on table public.platform_announcement_reads is
  'プラットフォームお知らせの既読/承認状態(user 単位)';

-- ───────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────
alter table public.platform_announcements enable row level security;
alter table public.platform_announcement_reads enable row level security;

-- SELECT: 認証済みユーザは「自分が見るべきお知らせ」のみ
--   ・運営管理者(profiles.is_maira_admin) は全件閲覧可
--   ・それ以外は target_type='all' か、自分の所属 org が target_organization_ids に含まれる
--   ・公開期間内(published_at <= now() AND (expires_at is null OR expires_at > now()))
drop policy if exists pa_select on public.platform_announcements;
create policy pa_select
  on public.platform_announcements
  for select
  using (
    -- Maira 運営者は全件
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_maira_admin = true
    )
    or (
      -- 公開期間内
      published_at <= now()
      and (expires_at is null or expires_at > now())
      and (
        target_type = 'all'
        or (
          target_type = 'specific'
          and exists (
            select 1 from public.organization_members om
            where om.user_id = auth.uid()
              and om.organization_id = any(target_organization_ids)
          )
        )
      )
    )
  );

-- INSERT / UPDATE / DELETE: Maira 運営者のみ
drop policy if exists pa_admin_insert on public.platform_announcements;
create policy pa_admin_insert
  on public.platform_announcements
  for insert
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true)
  );

drop policy if exists pa_admin_update on public.platform_announcements;
create policy pa_admin_update
  on public.platform_announcements
  for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true)
  );

drop policy if exists pa_admin_delete on public.platform_announcements;
create policy pa_admin_delete
  on public.platform_announcements
  for delete
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_maira_admin = true)
  );

-- 既読:本人のみ
drop policy if exists par_self_select on public.platform_announcement_reads;
create policy par_self_select
  on public.platform_announcement_reads
  for select
  using (auth.uid() = user_id);

drop policy if exists par_self_insert on public.platform_announcement_reads;
create policy par_self_insert
  on public.platform_announcement_reads
  for insert
  with check (auth.uid() = user_id);

drop policy if exists par_self_update on public.platform_announcement_reads;
create policy par_self_update
  on public.platform_announcement_reads
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists par_self_delete on public.platform_announcement_reads;
create policy par_self_delete
  on public.platform_announcement_reads
  for delete
  using (auth.uid() = user_id);

-- updated_at 自動更新
create or replace function public.set_pa_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_pa_updated_at on public.platform_announcements;
create trigger set_pa_updated_at
  before update on public.platform_announcements
  for each row execute function public.set_pa_updated_at();
