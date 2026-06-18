-- ============================================
-- 企業ごとの AI 利用上限設定(organization_ai_quotas)
--
-- 目的:
--   ・各エージェント企業が AI 機能の月次上限を 自由に 設定できる
--   ・組織側 4 kind(エージェント自身が叩く)は 組織横断の合算上限
--   ・求職者側 2 kind(連携求職者が叩く)は 求職者 1 人あたりの上限
--   ・admin だけが 編集可、advisor は 閲覧のみ
--
-- 既定値の扱い:
--   ・monthly_limit が null → lib/features/ai-usage.ts の
--     FREE_MONTHLY 定数(または hasAddon 時は ADDON_MONTHLY)を使用
--   ・monthly_limit が 0 → 完全に使用禁止
--   ・正の整数 → その値を 上限として 使う
-- ============================================

create table if not exists public.organization_ai_quotas (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  kind text not null check (kind in (
    'photo_enhance',
    'job_recommendation_seeker',
    'job_recommendation_agency',
    'recommendation_letter_draft',
    'agency_cv_draft',
    'agency_resume_draft'
  )),
  monthly_limit int,
  updated_at timestamptz not null default now(),
  updated_by_member_id uuid
    references public.organization_members(id) on delete set null,
  primary key (organization_id, kind)
);

comment on table public.organization_ai_quotas is
  'エージェント企業ごとの AI 機能 月次利用上限。null = 既定値、0 = 完全停止、正の整数 = 明示的な上限。';

alter table public.organization_ai_quotas enable row level security;

-- SELECT: 同 org メンバー全員(透明性のため advisor も閲覧可)
create policy oaq_select
  on public.organization_ai_quotas for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は SECURITY DEFINER RPC 経由のみ。
-- (admin 判定を RPC 内部で 行う。直接 DML は 暗黙拒否)


-- ============================================
-- 1. upsert_organization_ai_quota
--   ・admin だけが 自組織の 上限を 設定 / 更新できる
--   ・p_monthly_limit に null を 渡すと 「既定値に戻す」(レコード削除)
--   ・0 以上の整数を 渡すと upsert
-- ============================================
create or replace function public.upsert_organization_ai_quota(
  p_kind text,
  p_monthly_limit int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_caller_role text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  -- 自組織の admin であることを確認
  select id, role
    into v_caller_member_id, v_caller_role
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  -- kind の妥当性は CHECK 制約で 弾かれるが、エラーメッセージを 分かりやすくする
  if p_kind not in (
    'photo_enhance', 'job_recommendation_seeker',
    'job_recommendation_agency', 'recommendation_letter_draft',
    'agency_cv_draft', 'agency_resume_draft'
  ) then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;

  -- null = 既定値に戻す → レコードを 削除
  if p_monthly_limit is null then
    delete from public.organization_ai_quotas
    where organization_id = v_caller_org_id
      and kind = p_kind;
    return;
  end if;

  if p_monthly_limit < 0 then
    raise exception 'negative_limit' using errcode = 'P0001';
  end if;

  -- upsert
  insert into public.organization_ai_quotas (
    organization_id, kind, monthly_limit,
    updated_at, updated_by_member_id
  ) values (
    v_caller_org_id, p_kind, p_monthly_limit,
    now(), v_caller_member_id
  )
  on conflict (organization_id, kind) do update set
    monthly_limit = excluded.monthly_limit,
    updated_at = now(),
    updated_by_member_id = v_caller_member_id;
end;
$$;

comment on function public.upsert_organization_ai_quota(text, int) is
  'admin が自組織の AI 月次上限を 設定する。null で 既定値に戻す、0 で 完全停止。';


-- ============================================
-- 2. get_organization_ai_quotas
--   ・自組織の 全 kind の 上限を 返す(レコードが 無いものは null)
--   ・advisor も SELECT 可(同 org メンバー全員)
-- ============================================
create or replace function public.get_organization_ai_quotas()
returns table (
  kind text,
  monthly_limit int,
  updated_at timestamptz,
  updated_by_member_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  return query
  select q.kind, q.monthly_limit, q.updated_at, q.updated_by_member_id
  from public.organization_ai_quotas q
  where q.organization_id = v_caller_org_id;
end;
$$;

comment on function public.get_organization_ai_quotas() is
  '自組織の 全 AI quota 設定行を 返す(設定されていない kind は 行が 無い)。';


-- ============================================
-- 3. count_org_ai_usage_this_month
--   ・組織横断の 当月 AI 利用数(全メンバー合算)を 返す
--   ・SECURITY DEFINER で auth.users / organization_members を 跨ぐ
-- ============================================
create or replace function public.count_org_ai_usage_this_month(
  p_kind text,
  p_month_start timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org_id uuid;
  v_count bigint;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  select count(*)::bigint
    into v_count
  from public.ai_usage_events e
  where e.kind = p_kind
    and e.created_at >= p_month_start
    and e.user_id in (
      select user_id
      from public.organization_members
      where organization_id = v_caller_org_id
    );

  return coalesce(v_count, 0);
end;
$$;

comment on function public.count_org_ai_usage_this_month(text, timestamptz) is
  '自組織メンバー全員の 当月 AI 利用数を kind 別で 合算して 返す(quota チェック用)。';


-- ============================================
-- 4. get_seeker_quota_for_kind
--   ・連携求職者(seeker)が 自分の 上限を 知るための RPC
--   ・seeker は client_records.linked_user_id 経由で 紐づく 組織を 特定
--   ・複数 組織に 紐づいていれば 最大の 上限を 採用
--   ・連携が 無ければ null(呼び出し側で FREE_MONTHLY を 使う)
-- ============================================
create or replace function public.get_seeker_quota_for_kind(
  p_kind text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_max_limit int;
  v_has_unbounded boolean;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- linked な 組織を 全て 取得し、その 中で organization_ai_quotas に
  -- レコードが ある ものの 最大値を 返す。1 つでも null(=既定値)が あれば
  -- null を 返す(呼び出し側で 既定値を 使う方が 寛容)。
  select
    coalesce(max(q.monthly_limit), null),
    bool_or(q.monthly_limit is null)
    into v_max_limit, v_has_unbounded
  from public.client_records c
  left join public.organization_ai_quotas q
    on q.organization_id = c.organization_id
   and q.kind = p_kind
  where c.linked_user_id = v_caller_user_id
    and c.link_status = 'linked';

  -- linked org が 無い場合 → null(呼び出し側で 既定値)
  -- linked org は あるが 設定無し(レコード なし)→ null(既定値)
  -- linked org の どれかが null 明示(全部 設定なし)→ null
  -- linked org に 明示的な 上限あり → その 最大値
  if v_has_unbounded then
    return null;
  end if;

  return v_max_limit;
end;
$$;

comment on function public.get_seeker_quota_for_kind(text) is
  '求職者の 紐づき先 組織の AI quota の 最大値を 返す。複数組織なら 最も 寛大な ものを 採用。';
