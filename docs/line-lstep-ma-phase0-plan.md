# LINE Lステップ MA:Phase 0 実装計画(既存プリセットの吸収)

- ステータス:実装着手待ち
- 最終更新:2026-07-11
- 関連:[全体設計](./line-lstep-ma-design.md) / [ADR 0007](./adr/0007-line-lstep-ma-flow.md)
- Phase 0 の位置づけ:**新体系(`ma_flows`)を導入し、既存 7 プリセットの Flow マッピングを準備する Prep フェーズ**。この時点では新 dispatcher は稼働させず、旧 `line-dispatch` cron を並走させたまま安全に着地する。

---

## 1. 目的 / スコープ

### 目的

- 新テーブル(`ma_flows` / `ma_flow_steps` / `ma_flow_subscriptions`)を投入し、Phase 1 の中核実装(dispatcher / ビルダー UI)がすぐ着手できる状態にする
- 既存 7 LINE プリセットを Flow(初期は 1 ステップ Flow)として吸収し、意味的な単一化を果たす
- 旧 `ma_scenarios` を「凍結」する(新規 INSERT 停止、既存データは監査のため保持)
- カットオーバー時の重複送信を構造的に不可能にする

### スコープに含む

1. マイグレーション 1 本(スキーマ追加 + 列追加 + RLS + トリガー)
2. Flow プリセット定義コード(`lib/ma/flow-presets.ts`)
3. Backfill スクリプト(`scripts/backfill-flow-presets.ts`)
4. 旧 `ma_scenarios` の新規 INSERT 停止(API 層 + DB CHECK 制約)
5. カットオーバー手順書(本ドキュメント)

### スコープに含まない(Phase 1 以降)

- 新 dispatcher(`/api/internal/ma/flow-dispatch`)の実装
- シナリオビルダー UI
- 動的セグメント
- 旧 dispatcher(`/api/internal/ma/line-dispatch`)の撤去 → **Phase 1 完了後**

---

## 2. 前提

- dev Supabase プロジェクト:`maira-dev`(`pfebbpgcufintmulhydg`)
- prod Supabase プロジェクト:`maira-prod`(`xxatkimjfiaidxfuglae`)
- **prod への `db push` は明示指示があるまで禁止**(CLAUDE.md の運用ルール踏襲)
- 既存 7 LINE プリセット(`line_welcome_after_friend` 他)は `ma_scenario_presets` に投入済
- 既存 email 7 プリセットは Phase 0 の対象外(Phase 1 以降で検討)

---

## 3. 成果物一覧

| #   | 種別      | パス                                                                | 変更種別                 |
| --- | --------- | ------------------------------------------------------------------- | ------------------------ |
| 1   | migration | `supabase/migrations/20260711000003_add_ma_flows_tables.sql`        | 新規                     |
| 2   | migration | `supabase/migrations/20260711000004_freeze_ma_scenarios_writes.sql` | 新規                     |
| 3   | code      | `lib/ma/flow-presets.ts`                                            | 新規                     |
| 4   | code      | `lib/ma/flow-preset-types.ts`                                       | 新規                     |
| 5   | code      | `types/db.ts`                                                       | 型追加(手動 or 自動生成) |
| 6   | script    | `scripts/backfill-flow-presets.ts`                                  | 新規                     |
| 7   | doc       | `docs/line-lstep-ma-phase0-plan.md`(本ドキュメント)                 | 新規                     |

---

## 4. マイグレーション 1:`20260711000003_add_ma_flows_tables.sql`

**ポリシー命名規則**(既存 `msp_* / ms_* / mt_* / mcl_*` に倣う):

- `ma_flows` → `mf_*`
- `ma_flow_steps` → `mfs_*`
- `ma_flow_subscriptions` → `mfsub_*`

### 4.1 DDL 全文(コピペ可)

```sql
-- ============================================
-- Lステップ 相当 MA 拡張:Flow / Flow Steps / Flow Subscriptions
--
-- 既存 ma_scenarios (単発 トリガー = 1 通) を 発展 させ、
-- 多段 ステップ + 分岐 + 目標 達成 判定 を 表現 する 新 体系。
--
-- Phase 0 では スキーマ 投入 のみ、 dispatcher は 未実装(旧 line-dispatch 並走)。
-- Phase 1 で /api/internal/ma/flow-dispatch を 追加 し 新 系統 で 配信。
--
-- 詳細 設計:docs/line-lstep-ma-design.md
-- 方針:docs/adr/0007-line-lstep-ma-flow.md
-- ============================================

-- ────────────────────────────────────────
-- 1. ma_flows(多段 シナリオ 本体)
-- ────────────────────────────────────────
create table if not exists public.ma_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  channel text not null default 'line'
    check (channel in ('line')),
  -- トリガー 種別。 詳細 は design doc 参照
  trigger_type text not null check (trigger_type in (
    'friend_added',
    'tag_assigned',
    'tag_removed',
    'segment_matched',
    'form_submitted',
    'postback_received',
    'keyword_matched',
    'conversion_event',
    'manual'
  )),
  -- trigger 種別 ごと の 詳細 条件(tag_id / event_key / postback_data_prefix 等)
  trigger_config jsonb not null default '{}'::jsonb,
  -- 起動時 の セグメント 一致 必須 (nullable)
  target_segment_id uuid,  -- FK は Phase 1 で line_segments 追加 後 に 張る
  -- 目標 イベント。 達成 で subscription を goal_achieved に
  goal_event_key text,
  -- 一度 完了/中断 した 友達 を 再度 エンロール 可能 か
  allow_reentry boolean not null default false,
  -- 1 日 の 送信 上限(通数 コスト 対策)
  max_send_per_day integer,
  -- 送信 時間帯 制約: {"only_between":{"start":"09:00","end":"20:00","tz":"Asia/Tokyo"}}
  send_time_window_json jsonb,
  is_active boolean not null default false,
  -- どの プリセット から 生成 された か (nullable、 手動 作成 は null)
  origin_preset_key text,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.ma_flows is
  '多段 シナリオ 本体。 Lステップ 相当 の Flow 定義。';
comment on column public.ma_flows.origin_preset_key is
  'flow-presets.ts の どの 定義 から 生成 された か。 手動 作成 flow は null。';
comment on column public.ma_flows.goal_event_key is
  'ma_conversion_events.event_key と 突合 する 目標 イベント。 達成 で subscription 中断。';

create index if not exists idx_ma_flows_org_active
  on public.ma_flows(organization_id, is_active);
create index if not exists idx_ma_flows_trigger
  on public.ma_flows(trigger_type, is_active)
  where is_active = true;

alter table public.ma_flows enable row level security;

create policy mf_select
  on public.ma_flows for select
  using (organization_id = public.current_user_organization_id());
create policy mf_admin_insert
  on public.ma_flows for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mf_admin_update
  on public.ma_flows for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mf_admin_delete
  on public.ma_flows for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_flows_updated_at on public.ma_flows;
create trigger set_ma_flows_updated_at
  before update on public.ma_flows
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 2. ma_flow_steps(Flow 内 ステップ)
-- ────────────────────────────────────────
create table if not exists public.ma_flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.ma_flows(id) on delete cascade,
  step_order integer not null check (step_order >= 1),
  name text,
  -- 前 ステップ から の 遅延 秒。 step_order=1 は trigger から の 遅延。
  delay_from_previous_seconds bigint not null default 0 check (delay_from_previous_seconds >= 0),
  action_type text not null check (action_type in (
    'send_message',
    'assign_tag',
    'remove_tag',
    'add_score',
    'set_field',
    'wait',
    'branch',
    'stop'
  )),
  action_config jsonb not null default '{}'::jsonb,
  template_id uuid references public.ma_templates(id),
  -- action=branch の とき 必須
  branch_condition_json jsonb,
  next_step_on_true integer,
  next_step_on_false integer,
  -- branch 以外 で 両 null なら step_order+1、 それ 以外 なら 指定 先 へ
  next_step_on_default integer,
  -- このステップ 到達時 に goal 達成 判定 する か
  goal_check_on_entry boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (flow_id, step_order),
  -- send_message action は template_id 必須
  constraint mfs_send_message_needs_template
    check (action_type <> 'send_message' or template_id is not null),
  -- branch action は branch_condition_json 必須
  constraint mfs_branch_needs_condition
    check (action_type <> 'branch' or branch_condition_json is not null)
);

comment on table public.ma_flow_steps is
  'Flow 内 の 1 ステップ(送信 / タグ 付与 / 分岐 / スコア 加算 等)。';

create index if not exists idx_ma_flow_steps_flow
  on public.ma_flow_steps(flow_id, step_order);
create index if not exists idx_ma_flow_steps_template
  on public.ma_flow_steps(template_id)
  where template_id is not null;

alter table public.ma_flow_steps enable row level security;

-- flow_id 経由 で org を 引く ため EXISTS 節 で 判定
create policy mfs_select
  on public.ma_flow_steps for select
  using (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
  );
create policy mfs_admin_insert
  on public.ma_flow_steps for insert
  with check (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
    and public.current_user_organization_role() = 'admin'
  );
create policy mfs_admin_update
  on public.ma_flow_steps for update
  using (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
    and public.current_user_organization_role() = 'admin'
  );
create policy mfs_admin_delete
  on public.ma_flow_steps for delete
  using (
    exists (
      select 1 from public.ma_flows f
      where f.id = ma_flow_steps.flow_id
        and f.organization_id = public.current_user_organization_id()
    )
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_flow_steps_updated_at on public.ma_flow_steps;
create trigger set_ma_flow_steps_updated_at
  before update on public.ma_flow_steps
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 3. ma_flow_subscriptions(friend × Flow の 進行 状態)
-- ────────────────────────────────────────
create table if not exists public.ma_flow_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_id uuid not null references public.ma_flows(id) on delete cascade,
  -- line_user_links と 参照 する が FK は 張らない(未連携 友達 も 許容)
  line_user_id text not null,
  client_record_id uuid references public.client_records(id) on delete set null,
  current_step_order integer not null default 1,
  next_action_at timestamptz not null,
  status text not null default 'active' check (status in (
    'active', 'goal_achieved', 'completed', 'canceled', 'paused', 'failed'
  )),
  entered_via text not null default 'trigger_auto' check (entered_via in (
    'trigger_auto', 'manual', 'imported'
  )),
  entered_at timestamptz not null default now(),
  goal_achieved_at timestamptz,
  completed_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.ma_flow_subscriptions is
  'friend × Flow の 進行 状態。 cron が next_action_at を 走査 して 実行。';

-- 同 Flow に active/paused な subscription は 1 件 のみ(allow_reentry=true でも 過去 の 完了 は 残す)
create unique index if not exists uniq_ma_flow_subscriptions_active
  on public.ma_flow_subscriptions(flow_id, line_user_id)
  where status in ('active', 'paused');

-- cron の 走査 用
create index if not exists idx_ma_flow_subscriptions_next
  on public.ma_flow_subscriptions(status, next_action_at)
  where status = 'active';

create index if not exists idx_ma_flow_subscriptions_org_user
  on public.ma_flow_subscriptions(organization_id, line_user_id, status);

alter table public.ma_flow_subscriptions enable row level security;

create policy mfsub_select
  on public.ma_flow_subscriptions for select
  using (organization_id = public.current_user_organization_id());
-- INSERT / UPDATE は 基本 service_role(dispatcher)経由。
-- 手動 enroll / cancel の ため の admin 権限 のみ 許可。
create policy mfsub_admin_insert
  on public.ma_flow_subscriptions for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mfsub_admin_update
  on public.ma_flow_subscriptions for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
create policy mfsub_admin_delete
  on public.ma_flow_subscriptions for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_flow_subscriptions_updated_at on public.ma_flow_subscriptions;
create trigger set_ma_flow_subscriptions_updated_at
  before update on public.ma_flow_subscriptions
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────
-- 4. 既存 テーブル へ の 列 追加(Phase 1 dispatcher で 使用)
-- ────────────────────────────────────────
alter table public.ma_send_logs
  add column if not exists ma_flow_step_id uuid references public.ma_flow_steps(id) on delete set null;

comment on column public.ma_send_logs.ma_flow_step_id is
  '新 Flow 体系 で 送信 された 場合 の 対応 step。 旧 ma_scenarios 経由 送信 は null。';

create index if not exists idx_ma_send_logs_flow_step
  on public.ma_send_logs(ma_flow_step_id)
  where ma_flow_step_id is not null;

alter table public.ma_click_links
  add column if not exists ma_flow_step_id uuid references public.ma_flow_steps(id) on delete set null;

create index if not exists idx_ma_click_links_flow_step
  on public.ma_click_links(ma_flow_step_id)
  where ma_flow_step_id is not null;
```

### 4.2 このマイグレーションで注意すべき点

- `target_segment_id` は `line_segments` テーブルが Phase 1 で追加されるまで FK 制約を張らない(`uuid` 列のみ)。Phase 1 で `ALTER TABLE ADD CONSTRAINT` する
- `ma_flow_subscriptions.line_user_id` に FK なし(未連携友だち対応)。データ整合性は アプリ層で担保
- `mfs_send_message_needs_template` / `mfs_branch_needs_condition` の CHECK 制約で action_type と関連列の整合を強制
- `uniq_ma_flow_subscriptions_active` は partial unique index(PostgreSQL 独自)。allow_reentry=true でも過去の完了 subscription が残る設計
- RLS は既存パターン踏襲。dispatcher は service_role で動作するのでバイパス可

---

## 5. マイグレーション 2:`20260711000004_freeze_ma_scenarios_writes.sql`

Phase 0 完了時点で旧 `ma_scenarios` の新規 INSERT を停止。既存行は残す(表示・監査用)。

### 5.1 DDL 全文

```sql
-- ============================================
-- 旧 ma_scenarios の 新規 INSERT を 凍結
--
-- Phase 0 で 新 ma_flows 体系 に 集約 する 判断(ADR 0007)に 基づく。
-- 既存 行 は 監査 目的 で 残す。 UPDATE(is_active の 切替 等)は
-- Phase 1 で 旧 cron 撤去 する まで 引き続き 可能。
--
-- 手法:カラム 追加 で 凍結 フラグ を 立て、 INSERT を 拒否 する 関数 トリガー を 付与。
-- ============================================

-- 凍結 開始 日 を 記録(監査 用)
alter table public.ma_scenarios
  add column if not exists frozen_at timestamptz;

comment on column public.ma_scenarios.frozen_at is
  '新規 INSERT を 拒否 する ように なった 日。 Phase 0 完了 時 に 全 行 の 参考 情報 として 記録。';

-- 既存 行 に frozen_at を 記録
update public.ma_scenarios
  set frozen_at = now()
  where frozen_at is null;

-- 以降 の INSERT を 拒否 する トリガー
create or replace function public.reject_ma_scenarios_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception '[Phase 0] ma_scenarios は 凍結 されました。 新規 flow は public.ma_flows を 使用 して ください。';
end;
$$;

drop trigger if exists reject_ma_scenarios_insert on public.ma_scenarios;
create trigger reject_ma_scenarios_insert
  before insert on public.ma_scenarios
  for each row execute function public.reject_ma_scenarios_insert();

-- 注意:UPDATE / DELETE は 依然 として 可能 に して おく。
-- Phase 1 で 旧 line-dispatch cron が 撤去 された あと に、
-- 別 migration で テーブル 全体 を read-only 化 する。
```

### 5.2 API 層側の対応

- `/api/agency/ma/scenarios/route.ts` の POST を 410 Gone に変更(コメントで理由明記)
- `/agency/marketing` UI の「シナリオ追加」ボタンを disable、tooltip に「新 Flow ビルダーへ移行中」表示
- Phase 1 完了で完全撤去

---

## 6. 既存 7 プリセット → Flow マッピング表

Phase 0 では **Flow プリセット定義を code で持ち**、Backfill スクリプトで既存 org の active な `ma_scenarios` に対応する Flow を生成する。

### 6.1 プリセット定義の場所

`lib/ma/flow-presets.ts`(新規):

```ts
import type { FlowPreset } from "./flow-preset-types";

export const LINE_FLOW_PRESETS: FlowPreset[] = [
  {
    key: "line_welcome_after_friend",
    name: "LINE 友だち追加後 ウェルカム",
    description: "公式 LINE 友だち追加 直後 の オンボーディング Flow",
    channel: "line",
    trigger_type: "friend_added",
    trigger_config: {},
    goal_event_key: "profile_completed",
    allow_reentry: false,
    steps: [
      {
        step_order: 1,
        name: "ウェルカム メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_welcome_after_friend",
      },
    ],
  },
  {
    key: "line_dormant_outreach",
    name: "LINE 休眠求職者 掘り起こし",
    description: "最終 inbound から 30 日 経過 した 求職者 へ 再 アプローチ",
    channel: "line",
    trigger_type: "segment_matched",
    trigger_config: { segment_kind: "last_inbound_days_gte", days: 30 },
    goal_event_key: null,
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "掘り起こし メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_dormant_outreach",
      },
    ],
  },
  {
    key: "line_register_meeting_promotion",
    name: "LINE 登録者 面談促進",
    description: "友だち追加 から N 日 経過 し 面談 未設定 の 場合 に 案内",
    channel: "line",
    trigger_type: "segment_matched",
    trigger_config: { segment_kind: "friend_added_days_gte_no_meeting", days: 3 },
    goal_event_key: "meeting_confirmed",
    allow_reentry: false,
    steps: [
      {
        step_order: 1,
        name: "面談促進 メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_register_meeting_promotion",
      },
    ],
  },
  {
    key: "line_meeting_reminder",
    name: "LINE 面談前 リマインド",
    description: "面談 予定 日 の 1 日前 に リマインド",
    channel: "line",
    trigger_type: "conversion_event",
    trigger_config: { event_key: "meeting_scheduled", offset_seconds: -86400 },
    goal_event_key: "meeting_completed",
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "面談 リマインド",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_meeting_reminder",
      },
    ],
  },
  {
    key: "line_job_introduction",
    name: "LINE 求人紹介",
    description: "面談 完了 後 N 日 経過 で 応募 が ない 場合 に 求人 を 紹介",
    channel: "line",
    trigger_type: "segment_matched",
    trigger_config: { segment_kind: "meeting_done_days_gte_no_application", days: 3 },
    goal_event_key: "application_submitted",
    allow_reentry: false,
    steps: [
      {
        step_order: 1,
        name: "求人紹介 メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_job_introduction",
      },
    ],
  },
  {
    key: "line_after_interview_followup",
    name: "LINE 面接後 フォロー",
    description: "面接 確定 日 から 1 日後 に フォロー メッセージ",
    channel: "line",
    trigger_type: "conversion_event",
    trigger_config: { event_key: "interview_done", offset_seconds: 86400 },
    goal_event_key: "offer_received",
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "面接後 フォロー",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_after_interview_followup",
      },
    ],
  },
  {
    key: "line_birthday_greeting",
    name: "LINE 誕生日 お祝い",
    description: "求職者 の 誕生日 当日 に お祝い メッセージ",
    channel: "line",
    trigger_type: "segment_matched",
    trigger_config: { segment_kind: "birthday_today" },
    goal_event_key: null,
    allow_reentry: true,
    steps: [
      {
        step_order: 1,
        name: "誕生日 メッセージ",
        delay_from_previous_seconds: 0,
        action_type: "send_message",
        legacy_scenario_key: "line_birthday_greeting",
      },
    ],
  },
];
```

### 6.2 プリセット vs 既存 preset の対応表

| Flow preset key(新)               | 旧 `ma_scenario_presets.key` | 旧 trigger_event               | 新 trigger_type    | 新 trigger_config 概要                 |
| --------------------------------- | ---------------------------- | ------------------------------ | ------------------ | -------------------------------------- |
| `line_welcome_after_friend`       | 同名                         | `line_friend_added`            | `friend_added`     | (default_trigger_days は 0 のため即時) |
| `line_dormant_outreach`           | 同名                         | `line_last_inbound_threshold`  | `segment_matched`  | last_inbound から 30 日超              |
| `line_register_meeting_promotion` | 同名                         | `line_friend_added_no_meeting` | `segment_matched`  | 追加 3 日超 × 面談未設定               |
| `line_meeting_reminder`           | 同名                         | `meeting_scheduled`            | `conversion_event` | offset -86400 秒(1 日前)               |
| `line_job_introduction`           | 同名                         | `meeting_done_no_application`  | `segment_matched`  | 面談完了 3 日超 × 応募 0               |
| `line_after_interview_followup`   | 同名                         | `interview_done`               | `conversion_event` | offset +86400 秒(1 日後)               |
| `line_birthday_greeting`          | 同名                         | `candidate_birthday`           | `segment_matched`  | 誕生日今日                             |

**旧 `default_trigger_days` の扱い**:

- 「N 日前 / N 日後」→ `conversion_event.trigger_config.offset_seconds` に変換(旧 `-1` → `-86400`)
- 「N 日以上経過」→ `segment_matched.trigger_config.days` に変換
- 旧 `trigger_days_override`(org 側の上書き)は Backfill 時に読み取って新 Flow に反映

### 6.3 テンプレの引き継ぎ

新 Flow の各 send_message ステップは、既存 `ma_templates` を **そのまま参照する**(コピーしない):

- Backfill 時、`ma_flow_steps.template_id` = 既存 `ma_templates.id` を設定
- `ma_templates.scenario_id` は既存の `ma_scenarios.id` を指したまま(参照整合性のため)
- 新 Flow が旧 `ma_scenarios` を経由して同じ template を参照する構造

これにより暗号化テンプレの再暗号化コストゼロ、org 管理者の再編集不要。

---

## 7. Backfill スクリプト:`scripts/backfill-flow-presets.ts`

### 7.1 目的

既存 org が有効化している `ma_scenarios`(LINE のみ)に対応する `ma_flows` を生成する。

### 7.2 前提

- Node で `SUPABASE_SERVICE_ROLE_KEY` を用いて service_role 権限で実行
- dev / prod どちらでも動くように環境変数で分離
- 冪等性:同 org × 同 preset_key に対して 2 回実行しても新規行を作らない(`origin_preset_key` で判定)

### 7.3 疑似コード

```ts
async function backfillFlowPresets() {
  const orgs = await sb.from("organizations").select("id").throwOnError();
  for (const org of orgs.data ?? []) {
    // このorg で 有効化 されている LINE 系 ma_scenarios を 取得
    const scenarios = await sb
      .from("ma_scenarios")
      .select(
        "id, preset_id, trigger_days_override, is_active, ma_scenario_presets!inner(key, channel)",
      )
      .eq("organization_id", org.id)
      .eq("ma_scenario_presets.channel", "line");

    for (const scenario of scenarios.data ?? []) {
      const presetKey = scenario.ma_scenario_presets?.key;
      const flowPreset = LINE_FLOW_PRESETS.find((p) => p.key === presetKey);
      if (!flowPreset) continue;

      // 既存 flow を チェック(冪等性)
      const existing = await sb
        .from("ma_flows")
        .select("id")
        .eq("organization_id", org.id)
        .eq("origin_preset_key", presetKey)
        .maybeSingle();
      if (existing.data) continue;

      // trigger_days_override を trigger_config に 反映
      const triggerConfig = mergeTriggerDaysOverride(
        flowPreset.trigger_config,
        scenario.trigger_days_override,
      );

      // Flow 作成
      const { data: flow } = await sb
        .from("ma_flows")
        .insert({
          organization_id: org.id,
          name: flowPreset.name,
          description: flowPreset.description,
          channel: flowPreset.channel,
          trigger_type: flowPreset.trigger_type,
          trigger_config: triggerConfig,
          goal_event_key: flowPreset.goal_event_key,
          allow_reentry: flowPreset.allow_reentry,
          is_active: false, // 安全のため デフォルト false
          origin_preset_key: flowPreset.key,
        })
        .select("id")
        .single()
        .throwOnError();

      // Steps 作成
      for (const step of flowPreset.steps) {
        // 対応 template を 検索
        const template = await sb
          .from("ma_templates")
          .select("id")
          .eq("scenario_id", scenario.id)
          .maybeSingle();

        await sb
          .from("ma_flow_steps")
          .insert({
            flow_id: flow.id,
            step_order: step.step_order,
            name: step.name,
            delay_from_previous_seconds: step.delay_from_previous_seconds,
            action_type: step.action_type,
            template_id: template.data?.id ?? null,
          })
          .throwOnError();
      }

      console.log(`[backfill] org=${org.id} preset=${presetKey} flow=${flow.id}`);
    }
  }
}
```

### 7.4 実行方法

```bash
# dev
SUPABASE_URL=<dev_url> SUPABASE_SERVICE_ROLE_KEY=<dev_key> \
  pnpm tsx scripts/backfill-flow-presets.ts --dry-run

# 問題なければ 適用
SUPABASE_URL=<dev_url> SUPABASE_SERVICE_ROLE_KEY=<dev_key> \
  pnpm tsx scripts/backfill-flow-presets.ts
```

- `--dry-run` フラグで INSERT せず、対象行のみ列挙
- 実行後、`ma_flows` を SELECT して行数を目視確認

---

## 8. カットオーバー手順

Phase 0 は「新体系を導入するが稼働はさせない」ので、旧 cron を止めない。以下の順で進める。

### 8.1 dev 環境(まず dev で全て試す)

```
1. supabase projects list → maira-dev がリンク中か確認
2. cd /Users/arakaki/Maira
3. supabase db push  # migration 2 本を適用
4. types/db.ts の再生成(必要なら supabase gen types typescript)
5. pnpm test  # 既存テストが通ることを確認
6. pnpm tsx scripts/backfill-flow-presets.ts --dry-run  # 出力を目視確認
7. pnpm tsx scripts/backfill-flow-presets.ts  # 適用
8. Supabase Studio で ma_flows / ma_flow_steps を目視
9. 旧 /api/internal/ma/line-dispatch が引き続き動作することを確認(数分観察)
10. /agency/ma/scenarios の POST が 410 になっているか確認
```

### 8.2 prod 環境(dev で問題がなければ、ユーザーの明示指示を経て)

```
1. ユーザーに prod への適用の明示的な承認を得る
2. supabase link --project-ref xxatkimjfiaidxfuglae  # prod に切替
3. supabase projects list → maira-prod がリンク中か確認
4. supabase db push
5. pnpm tsx scripts/backfill-flow-presets.ts --dry-run  # 対象数を報告
6. ユーザーに再確認
7. pnpm tsx scripts/backfill-flow-presets.ts
8. Supabase Studio で確認
9. 数時間、旧 dispatcher が正常動作していることを監視
10. Vercel の環境変数に PHASE 0 完了フラグを立て、UI 側で「新体系準備完了」表示
```

**重要**:prod での push は CLAUDE.md 運用ルール通り、ユーザーの明示的な指示があった時のみ。

### 8.3 Phase 1 での撤去(Phase 0 の直後ではない)

Phase 1 完了で新 dispatcher が稼働開始したら:

- 旧 `/api/internal/ma/line-dispatch` の cron スケジュール(`vercel.json`)から削除
- 1 リリース経過後、`app/api/internal/ma/line-dispatch/` を削除
- `ma_scenarios` を read-only 化する追加 migration を投入

---

## 9. ロールバック手順

Phase 0 の DDL は 100% 追加のみで既存機能を破壊しないため、ロールバック不要な設計。ただし何らかの理由で戻す場合:

```sql
-- rollback (dev のみ、prod では 実行 前 に ユーザー 承認)
drop table if exists public.ma_flow_subscriptions cascade;
drop table if exists public.ma_flow_steps cascade;
drop table if exists public.ma_flows cascade;
alter table public.ma_send_logs drop column if exists ma_flow_step_id;
alter table public.ma_click_links drop column if exists ma_flow_step_id;
drop trigger if exists reject_ma_scenarios_insert on public.ma_scenarios;
drop function if exists public.reject_ma_scenarios_insert();
alter table public.ma_scenarios drop column if exists frozen_at;
```

---

## 10. テスト計画

### 10.1 マイグレーション適用テスト

- [ ] `supabase db push` がエラーなく完了する(dev)
- [ ] `ma_flows` / `ma_flow_steps` / `ma_flow_subscriptions` が作成されている
- [ ] `ma_send_logs.ma_flow_step_id` / `ma_click_links.ma_flow_step_id` が追加されている
- [ ] `ma_scenarios` に INSERT を試みると例外が発生する(意図した凍結挙動)
- [ ] 既存の `ma_scenarios` SELECT / UPDATE は変わらず動作する

### 10.2 RLS テスト

- [ ] 同 org の member として ログイン → `ma_flows` を SELECT できる
- [ ] 別 org の member として ログイン → 上記 org の `ma_flows` は SELECT できない
- [ ] 同 org の operator ロール → INSERT/UPDATE/DELETE は不可
- [ ] 同 org の admin ロール → INSERT/UPDATE/DELETE 可能

### 10.3 Backfill スクリプトテスト

- [ ] `--dry-run` で INSERT が発生しない
- [ ] 通常実行後、既存 org × 有効化済プリセット数だけ `ma_flows` 行が生成される
- [ ] 全 Flow は `is_active=false` で生成される(安全側)
- [ ] `origin_preset_key` が正しく設定されている
- [ ] 各 Flow の step が 1 件生成され、`template_id` が既存 `ma_templates` を指している
- [ ] 2 回目実行しても新規行は増えない(冪等性)

### 10.4 既存機能の回帰テスト

- [ ] `/api/internal/ma/line-dispatch` の cron が Phase 0 適用後も従来通り動作する
- [ ] `/agency/marketing` の既存 UI が壊れていない
- [ ] `ma_scenarios` の is_active トグルは依然として動作する
- [ ] `ma_templates` の編集は依然として動作する

---

## 11. タイムライン目安

| 作業                                   | 所要 | 実施者         |
| -------------------------------------- | ---- | -------------- |
| Migration 1 作成 + dev push            | 半日 | Claude Code    |
| RLS テスト                             | 半日 | Claude Code    |
| Migration 2 作成 + 旧 API 410 化       | 半日 | Claude Code    |
| flow-presets.ts + 型定義               | 半日 | Claude Code    |
| Backfill スクリプト実装 + dry-run 検証 | 1 日 | Claude Code    |
| Backfill を dev で実行 + 動作確認      | 半日 | ユーザー確認   |
| Phase 0 完了レビュー                   | 半日 | ユーザー       |
| prod への適用(明示指示後)              | 1 日 | ユーザー確認下 |

合計:**dev 完了まで 3〜4 営業日**、prod カットオーバーは別途承認。

---

## 12. 未決事項

| #   | 論点                                                                                | 現時点の想定                                                                                                                   |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `trigger_days_override` を Flow に反映するとき、`trigger_config` のどのキーに書くか | `days` を統一キーにする(preset 定義側で `days: 30` のような形式で受ける)                                                       |
| 2   | 既存 `ma_scenarios` の UPDATE(is_active トグル)は Phase 0 で残すか                  | 残す。Phase 1 完了まで旧 cron が稼働するため必要                                                                               |
| 3   | Backfill を「全 org 一斉」ではなく「Phase 1 UI で 1 org ずつ」にする案              | Phase 0 は「準備」なので一斉 Backfill(is_active=false で安全)。有効化は Phase 1 の UI から                                     |
| 4   | 新 Flow で `ma_templates` を共有することの副作用                                    | 旧 `ma_scenarios` を削除したら Flow が孤立するため、Phase 1 撤去時に template を Flow-scoped にコピーする追加 migration が必要 |
| 5   | 旧 email 系 7 プリセット(non-LINE)の扱い                                            | Phase 0 は LINE のみ対象。email 系は Phase 2 以降で判断                                                                        |

---

## 13. 次のアクション

Phase 0 実装は上記の順序で以下ステップに分解可能:

1. **Step A**: マイグレーション 2 本を作成 → dev push → RLS テスト
2. **Step B**: `lib/ma/flow-presets.ts` + 型を作成
3. **Step C**: Backfill スクリプト実装 → dry-run で件数確認
4. **Step D**: dev で backfill 実行 → 動作確認
5. **Step E**: 旧 API 410 化 + UI 側の表示調整
6. **Step F**: Phase 0 完了レビュー(ユーザーと)
7. (別途承認)prod 反映

Step A から順に着手する場合、まず Step A のみ実装を切り出して着手できる。
