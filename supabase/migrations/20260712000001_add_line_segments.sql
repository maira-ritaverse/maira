-- ============================================
-- Phase 1 P1-A:動的 セグメント (line_segments) + 自由項目 (friend_fields)
--
-- 目的 :
--   ・Lステップ 相当 の 「タグ AND スコア AND 最終活動 AND ...」 の 複合 条件 で
--     友達 を 絞り込む 動的 セグメント を 追加。
--   ・ma_flows.target_segment_id の FK を 補完 (Phase 0 で uuid 列 のみ 追加 済)。
--   ・friend_fields (自由項目 = 友だち 情報欄) も 同時 追加。
--     - field_equals / field_exists の 実装 基盤
--     - Phase 1 の Flow.set_field アクション の 保存先
--
-- 評価 関数 :
--   ・build_segment_where(condition jsonb, org_id uuid) → SQL WHERE 節 (text)
--     JSONB DSL を 再帰的 に SQL 式 へ 翻訳。 identifier は 固定、 値 は
--     %L (quote_literal) で 安全 化。
--   ・select_friends_by_segment_filter(org_id, filter jsonb) → setof line_user_id
--     セグメント に 一致 する 友達 の line_user_id リスト。
--   ・count_friends_by_segment_filter(org_id, filter jsonb) → int
--     マッチ 件数 (プレビュー用)。
--
-- Phase 1 実装 kind :
--   ・has_tag / not_has_tag
--   ・days_since_last_activity_gte
--   ・days_since_added_lte / gte
--   ・field_equals / field_exists
--   ・clicked_link_in_flow
--   ・and / or / not (composite)
--
-- Phase 2 予約 kind (現時点 常に false を 返す スタブ) :
--   ・score_gte / score_lte              (engagement_score 列 は Phase 2)
--   ・entry_source_in                    (entry_source_code 列 は Phase 3)
--   ・conversion_event_present / absent  (ma_conversion_events テーブル は Phase 2)
--
-- 関連 :
--   ・docs/line-lstep-ma-design.md §5.1
--   ・docs/line-lstep-ma-phase1-plan.md §4.1
-- ============================================

-- ────────────────────────────────────────
-- 1. friend_fields (自由項目 = 友だち 情報欄)
-- ────────────────────────────────────────
create table if not exists public.friend_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  line_user_id text not null,
  key text not null,
  value text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, line_user_id, key)
);

comment on table public.friend_fields is
  '友だち に 紐付く 自由項目 (会社名 / 生年月日 / 予約日 等)。 line_user_id 参照 (未連携 友達 も 保存 可)。';

create index if not exists idx_friend_fields_org_user
  on public.friend_fields(organization_id, line_user_id);
create index if not exists idx_friend_fields_org_key_value
  on public.friend_fields(organization_id, key, value);

alter table public.friend_fields enable row level security;

create policy ff_select
  on public.friend_fields for select
  using (organization_id = public.current_user_organization_id());
create policy ff_admin_insert
  on public.friend_fields for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy ff_admin_update
  on public.friend_fields for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy ff_admin_delete
  on public.friend_fields for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_friend_fields_updated_at on public.friend_fields;
create trigger set_friend_fields_updated_at
  before update on public.friend_fields
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 2. line_segments (動的 セグメント)
-- ────────────────────────────────────────
create table if not exists public.line_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  filter_dsl_json jsonb not null,
  -- 直近 の マッチ 件数 (プレビュー用 キャッシュ、 更新 は 別 RPC)
  friend_count_cache integer,
  last_computed_at timestamptz,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.line_segments is
  '動的 セグメント 定義。 filter_dsl_json は SegmentFilter JSON。 Flow の trigger / Broadcast 対象 / 手動 enroll で 共用。';
comment on column public.line_segments.filter_dsl_json is
  'SegmentCondition の 木構造 (has_tag / and / or / not 等)。 詳細 は lib/ma/segment-dsl.ts。';

create index if not exists idx_line_segments_org
  on public.line_segments(organization_id);

alter table public.line_segments enable row level security;

create policy ls_select
  on public.line_segments for select
  using (organization_id = public.current_user_organization_id());
create policy ls_admin_insert
  on public.line_segments for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy ls_admin_update
  on public.line_segments for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy ls_admin_delete
  on public.line_segments for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_line_segments_updated_at on public.line_segments;
create trigger set_line_segments_updated_at
  before update on public.line_segments
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 3. ma_flows.target_segment_id に FK 制約 補完
--    (Phase 0 では line_segments 未存在 の ため uuid 列 のみ だった)
-- ────────────────────────────────────────
alter table public.ma_flows
  drop constraint if exists ma_flows_target_segment_fk;
alter table public.ma_flows
  add constraint ma_flows_target_segment_fk
  foreign key (target_segment_id) references public.line_segments(id) on delete set null;

-- ────────────────────────────────────────
-- 4. 内部 関数:SegmentCondition JSONB → SQL WHERE 節 (text) に 翻訳
--
-- 呼び出し 側 (build するとき) は 主 SELECT で 外側 line_user_links を "l" で
-- 別名付け して 呼ぶ 前提。 各 leaf は "l.line_user_id / l.organization_id /
-- l.last_activity_at / l.created_at" を 参照 する 式 を 返す。
--
-- 値 は 全 て %L (quote_literal) で 型 変換 込み で 埋め込む ため、
-- SQL インジェクション は 発生 しない (invalid UUID や 型 不一致 は
-- runtime エラー に なる が、 データ 変更 に は 至らない)。
-- ────────────────────────────────────────
create or replace function public.build_segment_where(
  p_condition jsonb,
  p_organization_id uuid
) returns text
language plpgsql
immutable
as $$
declare
  v_kind text;
  v_sub jsonb;
  v_parts text[];
  v_days text;
begin
  if p_condition is null or jsonb_typeof(p_condition) <> 'object' then
    return 'true';
  end if;

  v_kind := p_condition->>'kind';

  if v_kind is null then
    return 'true';
  end if;

  -- Composite: and
  if v_kind = 'and' then
    v_parts := array[]::text[];
    for v_sub in select * from jsonb_array_elements(coalesce(p_condition->'conditions', '[]'::jsonb))
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
    for v_sub in select * from jsonb_array_elements(coalesce(p_condition->'conditions', '[]'::jsonb))
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
    if p_condition->'condition' is null then
      return 'true';
    end if;
    return 'not (' || public.build_segment_where(p_condition->'condition', p_organization_id) || ')';
  end if;

  -- Leaf: has_tag / not_has_tag
  if v_kind = 'has_tag' then
    return format(
      'exists (select 1 from public.line_conversation_tag_assignments a where a.organization_id = l.organization_id and a.line_user_id = l.line_user_id and a.tag_id = %L::uuid)',
      p_condition->>'tag_id'
    );
  end if;
  if v_kind = 'not_has_tag' then
    return format(
      'not exists (select 1 from public.line_conversation_tag_assignments a where a.organization_id = l.organization_id and a.line_user_id = l.line_user_id and a.tag_id = %L::uuid)',
      p_condition->>'tag_id'
    );
  end if;

  -- Leaf: days_since_last_activity_gte
  if v_kind = 'days_since_last_activity_gte' then
    v_days := (p_condition->>'days')::int || ' days';
    return format('l.last_activity_at <= now() - interval %L', v_days);
  end if;

  -- Leaf: days_since_added_lte / gte (created_at 基準)
  if v_kind = 'days_since_added_lte' then
    v_days := (p_condition->>'days')::int || ' days';
    return format('l.created_at >= now() - interval %L', v_days);
  end if;
  if v_kind = 'days_since_added_gte' then
    v_days := (p_condition->>'days')::int || ' days';
    return format('l.created_at <= now() - interval %L', v_days);
  end if;

  -- Leaf: field_equals / field_exists
  if v_kind = 'field_equals' then
    return format(
      'exists (select 1 from public.friend_fields f where f.organization_id = l.organization_id and f.line_user_id = l.line_user_id and f.key = %L and f.value = %L)',
      p_condition->>'key',
      p_condition->>'value'
    );
  end if;
  if v_kind = 'field_exists' then
    return format(
      'exists (select 1 from public.friend_fields f where f.organization_id = l.organization_id and f.line_user_id = l.line_user_id and f.key = %L)',
      p_condition->>'key'
    );
  end if;

  -- Leaf: clicked_link_in_flow
  -- ma_click_links (click_count > 0) → ma_send_logs (recipient_line_user_id) → ma_flow_steps (flow_id) を 経由。
  if v_kind = 'clicked_link_in_flow' then
    return format(
      'exists (select 1 from public.ma_click_links cl join public.ma_send_logs sl on sl.id = cl.send_log_id join public.ma_flow_steps fs on fs.id = sl.ma_flow_step_id where cl.organization_id = l.organization_id and sl.recipient_line_user_id = l.line_user_id and cl.click_count > 0 and fs.flow_id = %L::uuid)',
      p_condition->>'flow_id'
    );
  end if;

  -- Phase 2 予約 kind:実装 まで 常に false
  if v_kind in ('score_gte', 'score_lte', 'entry_source_in', 'conversion_event_present', 'conversion_event_absent') then
    return 'false';
  end if;

  -- 未知 kind:安全側 で false (誰も マッチ しない)
  return 'false';
end;
$$;

comment on function public.build_segment_where(jsonb, uuid) is
  'SegmentCondition JSONB を line_user_links を "l" として 参照 する SQL WHERE 節 (text) に 翻訳。 Phase 1 実装 kind: has_tag / not_has_tag / days_* / field_* / clicked_link_in_flow / and / or / not。';

-- ────────────────────────────────────────
-- 5. パブリック 関数:セグメント filter に 一致 する line_user_id を 返す
--
-- 認可 :
--   ・authenticated: 呼び出し ユーザー が 該当 org の member で ある こと を 確認
--   ・service_role : バイパス (dispatcher / cron から の 呼び出し 用)
-- ────────────────────────────────────────
create or replace function public.select_friends_by_segment_filter(
  p_organization_id uuid,
  p_filter jsonb
) returns table(line_user_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_where text;
  v_root jsonb;
begin
  -- Access check (service_role は バイパス)
  if auth.role() <> 'service_role' then
    if not exists (
      select 1 from public.organization_members
      where organization_id = p_organization_id
        and user_id = auth.uid()
    ) then
      raise exception 'access denied for organization %', p_organization_id;
    end if;
  end if;

  -- root キー が ある なら それ を、 なければ 引数 自体 を 条件 として 扱う
  v_root := coalesce(p_filter->'root', p_filter);
  v_where := public.build_segment_where(v_root, p_organization_id);

  return query execute format(
    'select l.line_user_id from public.line_user_links l where l.organization_id = %L and l.unfollowed_at is null and (%s)',
    p_organization_id,
    v_where
  );
end;
$$;

comment on function public.select_friends_by_segment_filter(uuid, jsonb) is
  'セグメント filter に 一致 する 友だち (未 unfollow) の line_user_id を 返す。 dispatcher / preview UI から 呼ぶ。';

grant execute on function public.select_friends_by_segment_filter(uuid, jsonb)
  to authenticated, service_role;

-- ────────────────────────────────────────
-- 6. Count 版 (プレビュー UI 用)
-- ────────────────────────────────────────
create or replace function public.count_friends_by_segment_filter(
  p_organization_id uuid,
  p_filter jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_where text;
  v_root jsonb;
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    if not exists (
      select 1 from public.organization_members
      where organization_id = p_organization_id
        and user_id = auth.uid()
    ) then
      raise exception 'access denied for organization %', p_organization_id;
    end if;
  end if;

  v_root := coalesce(p_filter->'root', p_filter);
  v_where := public.build_segment_where(v_root, p_organization_id);

  execute format(
    'select count(*)::int from public.line_user_links l where l.organization_id = %L and l.unfollowed_at is null and (%s)',
    p_organization_id,
    v_where
  ) into v_count;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.count_friends_by_segment_filter(uuid, jsonb) is
  'セグメント filter に 一致 する 友だち 件数 を 返す。 friend_count_cache 更新 と プレビュー UI 用。';

grant execute on function public.count_friends_by_segment_filter(uuid, jsonb)
  to authenticated, service_role;
