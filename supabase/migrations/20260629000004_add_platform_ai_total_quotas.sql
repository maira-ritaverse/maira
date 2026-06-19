-- =====================================================================
-- 企業 ごと の AI 月次 「総量」上限 を 追加
--
-- 背景:
--   個別 kind 上限 (platform_ai_quotas) とは 別軸で、企業 全体 の AI 月次
--   利用回数 を 一括 で 制限 する 仕組みが 必要 に なった (料金プラン強制
--   の 第 1 ボトル として)。 既定は 全企業 500 回 / 月。
--
-- 対象 範囲:
--   ・エージェント職員の 利用 (agency_org scope kinds) のみ 集計対象
--   ・求職者 (seeker_per_user kinds) は 別軸で 管理 (将来 アプリ内 課金で
--     上限解除 予定)
--
-- 判定:
--   ・platform_ai_total_quotas に レコードあり → その値
--   ・なし → defaultTotalLimit (= 500) を 使う (アプリ層で 定数)
--   ・agency_org kind の チェック時 に、kind 別 上限 と 並行 して 総量 も 確認
--   ・どちらか 厳しい 方が 適用
--
-- セキュリティ:
--   RLS: 全拒否、RPC 経由 のみ。
-- =====================================================================

create table if not exists public.platform_ai_total_quotas (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  monthly_limit integer not null check (monthly_limit >= 0),
  notes text,
  set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_ai_total_quotas is
  'Maira 運営 が 企業 ごとに 月次 AI 利用 総量 を 強制 する 設定。 個別 kind 上限 と 並列 で 機能。';

alter table public.platform_ai_total_quotas enable row level security;

create policy "platform_ai_total_quotas_no_direct_access"
  on public.platform_ai_total_quotas
  for all
  using (false)
  with check (false);

-- ---------------------------------------------------------------------
-- RPC: admin による 総量上限 upsert
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_platform_ai_total_quota(
  p_org_id uuid,
  p_monthly_limit integer,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_maira_admin = true
  ) then
    raise exception 'admin_required';
  end if;

  if p_monthly_limit is null or p_monthly_limit < 0 then
    raise exception 'invalid_limit';
  end if;

  insert into public.platform_ai_total_quotas (organization_id, monthly_limit, notes, set_by)
  values (p_org_id, p_monthly_limit, p_notes, auth.uid())
  on conflict (organization_id) do update
    set monthly_limit = excluded.monthly_limit,
        notes         = excluded.notes,
        set_by        = excluded.set_by,
        updated_at    = now();
end;
$$;

grant execute on function public.admin_upsert_platform_ai_total_quota(uuid, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- RPC: admin による 総量上限 削除 (既定値 500 に 戻す)
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_platform_ai_total_quota(
  p_org_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_maira_admin = true
  ) then
    raise exception 'admin_required';
  end if;

  delete from public.platform_ai_total_quotas where organization_id = p_org_id;
end;
$$;

grant execute on function public.admin_delete_platform_ai_total_quota(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: admin が 1 組織 の 総量上限 を 取得
-- ---------------------------------------------------------------------
create or replace function public.admin_get_platform_ai_total_quota(
  p_org_id uuid
)
returns table (
  monthly_limit integer,
  notes text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_maira_admin = true
  ) then
    raise exception 'admin_required';
  end if;

  return query
  select t.monthly_limit, t.notes, t.updated_at
  from public.platform_ai_total_quotas t
  where t.organization_id = p_org_id;
end;
$$;

grant execute on function public.admin_get_platform_ai_total_quota(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: lib/features/ai-usage.ts から 呼出 — 呼出元 組織 の 総量上限を 返す
-- ---------------------------------------------------------------------
create or replace function public.get_platform_ai_total_quota_for_caller()
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
  v_limit integer;
begin
  select organization_id into v_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_org_id is null then
    return null;
  end if;

  select monthly_limit into v_limit
  from public.platform_ai_total_quotas
  where organization_id = v_org_id;

  return v_limit;
end;
$$;

grant execute on function public.get_platform_ai_total_quota_for_caller() to authenticated;

-- ---------------------------------------------------------------------
-- RPC: 呼出元 組織の 当月 agency_org 総量 (集計) を 返す
--
-- agency_org スコープ の 8 kind のみ 合算。 求職者 (seeker_per_user)
-- は 集計対象 外。
-- ---------------------------------------------------------------------
create or replace function public.count_org_ai_usage_total_this_month(
  p_month_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
  v_count integer;
begin
  select organization_id into v_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_org_id is null then
    return 0;
  end if;

  -- agency_org scope kinds の 合算 (seeker_per_user の photo_enhance /
  -- job_recommendation_seeker は 除外)
  select count(*)::integer into v_count
  from public.ai_usage_events e
  join public.organization_members m on m.user_id = e.user_id
  where m.organization_id = v_org_id
    and e.created_at >= p_month_start
    and e.kind in (
      'job_recommendation_agency',
      'recommendation_letter_draft',
      'agency_cv_draft',
      'agency_resume_draft',
      'job_extract_from_document',
      'csv_column_mapping'
    );

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.count_org_ai_usage_total_this_month(timestamptz) to authenticated;
