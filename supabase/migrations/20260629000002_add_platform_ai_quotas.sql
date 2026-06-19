-- =====================================================================
-- Maira 運営 (admin) が 企業ごとに AI 利用上限 を 強制 する 仕組み
--
-- 背景:
--   料金プラン強制 / 暴走時の 緊急介入 のため、Maira admin が 各企業の
--   月次 AI 上限を 上書き 設定 できる ように する。エージェント側 admin の
--   設定 (organization_ai_quotas) より 優先 する。
--
-- 設計:
--   ・別テーブル platform_ai_quotas に 保存 (organization_ai_quotas は そのまま)
--   ・(organization_id, kind) 主キー
--   ・monthly_limit = 0 で 完全停止 を 表現
--   ・notes (任意) は admin 用 メモ (「Pro プラン」「無料プラン強制」等)
--
-- 判定 優先順位 (lib/features/ai-usage.ts):
--   platform_ai_quotas → organization_ai_quotas → defaultLimitFor()
--
-- セキュリティ:
--   ・RLS:直接 SELECT / INSERT / UPDATE / DELETE は 拒否
--   ・専用 SECURITY DEFINER RPC 経由 のみ
--   ・RPC 内で profiles.is_maira_admin チェック
-- =====================================================================

create table if not exists public.platform_ai_quotas (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  monthly_limit integer not null check (monthly_limit >= 0),
  notes text,
  set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, kind)
);

comment on table public.platform_ai_quotas is
  'Maira 運営による 企業ごとの AI 上限 強制設定。organization_ai_quotas より 優先される。';

alter table public.platform_ai_quotas enable row level security;

-- RLS は 全拒否 (RPC 経由 のみ)
create policy "platform_ai_quotas_no_direct_access"
  on public.platform_ai_quotas
  for all
  using (false)
  with check (false);

-- ---------------------------------------------------------------------
-- RPC 1: admin による 上限 upsert (insert or update)
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_platform_ai_quota(
  p_org_id uuid,
  p_kind text,
  p_monthly_limit integer,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Maira admin 限定
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_maira_admin = true
  ) then
    raise exception 'admin_required';
  end if;

  if p_monthly_limit is null or p_monthly_limit < 0 then
    raise exception 'invalid_limit';
  end if;

  insert into public.platform_ai_quotas (organization_id, kind, monthly_limit, notes, set_by)
  values (p_org_id, p_kind, p_monthly_limit, p_notes, auth.uid())
  on conflict (organization_id, kind) do update
    set monthly_limit = excluded.monthly_limit,
        notes         = excluded.notes,
        set_by        = excluded.set_by,
        updated_at    = now();
end;
$$;

comment on function public.admin_upsert_platform_ai_quota(uuid, text, integer, text) is
  'Maira admin が 企業の AI 上限 を 強制設定。エージェント側 設定より 優先。';

grant execute on function public.admin_upsert_platform_ai_quota(uuid, text, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- RPC 2: admin による 上限 解除 (エージェント設定 に 戻す)
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_platform_ai_quota(
  p_org_id uuid,
  p_kind text
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

  delete from public.platform_ai_quotas
  where organization_id = p_org_id and kind = p_kind;
end;
$$;

comment on function public.admin_delete_platform_ai_quota(uuid, text) is
  'Maira admin による 強制上限 解除。削除後は エージェント側 設定 (または 既定値) に 戻る。';

grant execute on function public.admin_delete_platform_ai_quota(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- RPC 3: 企業の 全 kind 強制上限 を 取得 (admin UI 用)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_platform_ai_quotas(
  p_org_id uuid
)
returns table (
  kind text,
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
  select pq.kind, pq.monthly_limit, pq.notes, pq.updated_at
  from public.platform_ai_quotas pq
  where pq.organization_id = p_org_id;
end;
$$;

comment on function public.admin_list_platform_ai_quotas(uuid) is
  'Maira admin が 企業の 強制上限 を 一覧取得。';

grant execute on function public.admin_list_platform_ai_quotas(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RPC 4: 任意 org の 単一 kind 強制上限を 取得 (lib/features/ai-usage.ts から 内部利用)
--
-- 認可:呼出元 ユーザの auth.uid() が 同じ 組織の メンバー である場合に 限り 返す。
-- (エージェント側 で 「今月 残り N 回」表示 等に 使う)
-- ---------------------------------------------------------------------
create or replace function public.get_platform_ai_quota_for_caller(
  p_kind text
)
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
  -- 呼出元の 所属 organization を 引く
  select organization_id into v_org_id
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_org_id is null then
    return null;
  end if;

  select monthly_limit into v_limit
  from public.platform_ai_quotas
  where organization_id = v_org_id and kind = p_kind;

  return v_limit;
end;
$$;

comment on function public.get_platform_ai_quota_for_caller(text) is
  '呼出元 メンバーの 組織の 強制上限を 1 kind 分 取得 (lib/features/ai-usage.ts 用)。';

grant execute on function public.get_platform_ai_quota_for_caller(text) to authenticated;
