-- ============================================
-- ma_conversion_events
--
-- 目的:
--   CV(コンバージョン)イベントを 1 か所に集約する台帳。
--   ・referrals / interviews / 手動記録 など 業務側の状態変化を event_key に翻訳して保存
--   ・Flow の trigger_type='conversion_event' が発火する情報源(既に発火した履歴)
--   ・セグメント条件 conversion_event_present / conversion_event_absent の判定台帳
--   ・(将来) attribution 分析:どの Flow が どの CV に貢献したか
--
-- 設計:
--   ・organization_id + line_user_id + event_key + occurred_at で一意に紐付く
--   ・source / source_id は監査用(referral / interview / manual など)
--   ・metadata は将来の拡張余地(JSONB、平文 OK。個人情報は含めない方針)
--   ・INSERT / DELETE は service_role のみ:アプリ層のディスパッチャが記録する
--     (org_admin が UI から手動で操作するケースは Phase 2 以降で検討)
-- ============================================

create table if not exists public.ma_conversion_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- 発生元の LINE ユーザー(line_user_links.line_user_id と一致)
  line_user_id text not null,

  -- CV の種別。設計ドキュメント §7 の event_key 集合を想定。
  -- 例: application_submitted / meeting_confirmed / interview_done /
  --     offer_received / offer_accepted / onboarded / declined
  event_key text not null,

  -- CV 発生時刻。過去日付での遡及記録も許容(reprocessing 用)
  occurred_at timestamptz not null default now(),

  -- 監査用:このイベントを発火した業務側の source
  --   例: referral_status_change / interview_completed / interview_created / manual
  source text,
  -- 業務側の source レコード ID(referral_id / interview_id 等)。free-form。
  source_id uuid,

  -- 将来拡張用(job_posting_id や notes などを担当者判断で載せる)。
  -- 個人情報は載せない方針(暗号化しないため)。
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.ma_conversion_events is
  'CV(コンバージョン)イベントの台帳。 Flow の起動 / セグメント条件 / attribution の情報源。';
comment on column public.ma_conversion_events.event_key is
  'CV 種別。 application_submitted / meeting_confirmed / interview_done / offer_received / offer_accepted / onboarded / declined 等。';
comment on column public.ma_conversion_events.source is
  '発火元(referral_status_change / interview_completed 等)。監査 / デバッグ用。';

-- ────────────────────────────────────────
-- インデックス
-- ────────────────────────────────────────

-- セグメント条件 conversion_event_present の絞り込み用
-- (org × line × event × 直近 N 日以内)
create index if not exists idx_ma_conversion_events_org_line_event_time
  on public.ma_conversion_events (organization_id, line_user_id, event_key, occurred_at desc);

-- attribution / KPI 集計用
create index if not exists idx_ma_conversion_events_org_event_time
  on public.ma_conversion_events (organization_id, event_key, occurred_at desc);

-- ────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────

alter table public.ma_conversion_events enable row level security;

-- SELECT:自組織のイベントは organization_member が閲覧可(セグメント再計算 UI 等)
create policy "ma_conversion_events_select_own_org"
  on public.ma_conversion_events
  for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE ポリシーは作らない = service_role 経由のみ許可
-- (アプリ層のディスパッチャで確定した内容だけを書き込むため)

-- ────────────────────────────────────────
-- build_segment_where(既存)に conversion_event_present / absent を実装
-- (既存 SQL 関数を CREATE OR REPLACE で置き換え。他の kind は元の実装を維持)
-- ────────────────────────────────────────

create or replace function public.build_segment_where(
  p_condition jsonb,
  p_organization_id uuid
)
returns text
language plpgsql
stable
as $$
declare
  v_kind text;
  v_parts text[];
  v_sub jsonb;
  v_days int;
begin
  if p_condition is null then
    return 'true';
  end if;

  v_kind := p_condition->>'kind';

  -- Composite: and
  if v_kind = 'and' then
    v_parts := array[]::text[];
    for v_sub in select * from jsonb_array_elements(p_condition->'conditions')
    loop
      v_parts := array_append(v_parts, '(' || public.build_segment_where(v_sub, p_organization_id) || ')');
    end loop;
    if array_length(v_parts, 1) is null then
      return 'true';
    end if;
    return array_to_string(v_parts, ' and ');
  end if;

  -- Composite: or
  if v_kind = 'or' then
    v_parts := array[]::text[];
    for v_sub in select * from jsonb_array_elements(p_condition->'conditions')
    loop
      v_parts := array_append(v_parts, '(' || public.build_segment_where(v_sub, p_organization_id) || ')');
    end loop;
    if array_length(v_parts, 1) is null then
      return 'false';
    end if;
    return array_to_string(v_parts, ' or ');
  end if;

  -- Composite: not
  if v_kind = 'not' then
    return 'not (' || public.build_segment_where(p_condition->'condition', p_organization_id) || ')';
  end if;

  -- Leaf: has_tag / not_has_tag
  if v_kind = 'has_tag' then
    return format(
      'exists (select 1 from public.line_conversation_tag_assignments t where t.organization_id = l.organization_id and t.line_user_id = l.line_user_id and t.tag_id = %L::uuid)',
      p_condition->>'tag_id'
    );
  end if;
  if v_kind = 'not_has_tag' then
    return format(
      'not exists (select 1 from public.line_conversation_tag_assignments t where t.organization_id = l.organization_id and t.line_user_id = l.line_user_id and t.tag_id = %L::uuid)',
      p_condition->>'tag_id'
    );
  end if;

  -- Leaf: days_since_last_activity_gte
  if v_kind = 'days_since_last_activity_gte' then
    v_days := coalesce((p_condition->>'days')::int, 0);
    return format(
      'l.last_activity_at is not null and l.last_activity_at <= (now() - interval ''1 day'' * %s)',
      v_days
    );
  end if;

  -- Leaf: days_since_added_gte / lte
  if v_kind = 'days_since_added_gte' then
    v_days := coalesce((p_condition->>'days')::int, 0);
    return format(
      'l.created_at <= (now() - interval ''1 day'' * %s)',
      v_days
    );
  end if;
  if v_kind = 'days_since_added_lte' then
    v_days := coalesce((p_condition->>'days')::int, 0);
    return format(
      'l.created_at >= (now() - interval ''1 day'' * %s)',
      v_days
    );
  end if;

  -- Leaf: field_equals / field_exists
  if v_kind = 'field_equals' then
    return format(
      'exists (select 1 from public.friend_fields f where f.organization_id = l.organization_id and f.line_user_id = l.line_user_id and f.key = %L and f.value = %L)',
      p_condition->>'key', p_condition->>'value'
    );
  end if;
  if v_kind = 'field_exists' then
    return format(
      'exists (select 1 from public.friend_fields f where f.organization_id = l.organization_id and f.line_user_id = l.line_user_id and f.key = %L)',
      p_condition->>'key'
    );
  end if;

  -- Leaf: clicked_link_in_flow
  if v_kind = 'clicked_link_in_flow' then
    return format(
      'exists (select 1 from public.ma_click_links cl join public.ma_send_logs sl on sl.id = cl.send_log_id join public.ma_flow_steps fs on fs.id = sl.ma_flow_step_id where cl.organization_id = l.organization_id and sl.recipient_line_user_id = l.line_user_id and cl.click_count > 0 and fs.flow_id = %L::uuid)',
      p_condition->>'flow_id'
    );
  end if;

  -- Leaf: conversion_event_present
  -- 「◯◯という event_key の CV が within_days 日以内に発生した」
  if v_kind = 'conversion_event_present' then
    v_days := coalesce((p_condition->>'within_days')::int, 30);
    return format(
      'exists (select 1 from public.ma_conversion_events ce where ce.organization_id = l.organization_id and ce.line_user_id = l.line_user_id and ce.event_key = %L and ce.occurred_at >= (now() - interval ''1 day'' * %s))',
      p_condition->>'event_key', v_days
    );
  end if;

  -- Leaf: conversion_event_absent
  -- 「◯◯という event_key の CV が within_days 日以内に発生していない」
  if v_kind = 'conversion_event_absent' then
    v_days := coalesce((p_condition->>'within_days')::int, 30);
    return format(
      'not exists (select 1 from public.ma_conversion_events ce where ce.organization_id = l.organization_id and ce.line_user_id = l.line_user_id and ce.event_key = %L and ce.occurred_at >= (now() - interval ''1 day'' * %s))',
      p_condition->>'event_key', v_days
    );
  end if;

  -- Phase 2/3 予約 kind:実装まで常に false
  if v_kind in ('score_gte', 'score_lte', 'entry_source_in') then
    return 'false';
  end if;

  -- 未知 kind:安全側で false
  return 'false';
end;
$$;

comment on function public.build_segment_where(jsonb, uuid) is
  'SegmentCondition JSONB を line_user_links を "l" として参照する SQL WHERE 節 (text) に翻訳。 実装 kind: has_tag / not_has_tag / days_* / field_* / clicked_link_in_flow / conversion_event_present / conversion_event_absent / and / or / not。';
