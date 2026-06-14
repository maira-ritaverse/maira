-- ============================================
-- マーケティングオートメーション(MA)基盤
--
-- エージェントが「特定イベント + N日後」をトリガに、求職者へ自動メール
-- 配信するための 4 テーブル。EMPRO の MA 設計を参考に、Maira では
-- クライアントサイド暗号化のポリシーに沿ってテンプレ本文を暗号化する。
--
-- テーブル:
--   1. ma_scenario_presets    全組織共通のシナリオ定義(7プリセット投入)
--   2. ma_scenarios           組織が「有効化」したシナリオ(is_active / trigger_days)
--   3. ma_templates           シナリオごとの件名・本文(暗号化)
--   4. ma_consent_log         機能利用の同意ログ(法令遵守の特約モデル)
--
-- RLS は他の agency テーブルと同じ「SECURITY DEFINER ヘルパー」方式。
--   - SELECT: 同 organization のメンバー全員
--   - INSERT/UPDATE/DELETE: admin のみ
--   - presets は全員 SELECT のみ(変更は migration で行う)
--
-- ポリシー名のプレフィックスは msp_* / ms_* / mt_* / mcl_*。
-- ============================================

-- ============================================
-- 1. ma_scenario_presets(プリセット定義、全組織共通)
-- ============================================
-- 各シナリオを「どのイベントを起点に、何日後に送るか」の雛形として保持。
-- 組織側はこのプリセットを参照して ma_scenarios に有効化レコードを作る。
-- migration でデータを投入し、アプリ側から書き換えはしない(マスタ扱い)。
create table if not exists public.ma_scenario_presets (
  id uuid primary key default gen_random_uuid(),
  -- 識別子(英数字+アンダースコア)。アプリ側で型として参照する。
  key text not null unique,
  -- 配信対象。'candidate' = 求職者向け / 'recruiter' = 採用担当者向け
  audience text not null check (audience in ('candidate', 'recruiter')),
  -- チャネル。Phase C-1 ではメールのみ。将来 'line' を追加。
  channel text not null check (channel in ('email')),
  -- 表示名(日本語)
  name text not null,
  -- 説明文(管理画面で表示)
  description text not null,
  -- トリガーイベント。アプリ側の cron がこれを見て対象求職者を抽出する。
  -- 例: 'client_registered' / 'meeting_scheduled' / 'last_contact'
  trigger_event text not null,
  -- 起点から何日後 / 何日前か(負数 = N日前、正数 = N日後)
  default_trigger_days integer not null,
  -- 表示順
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.ma_scenario_presets is
  'MA シナリオのプリセット定義(全組織共通)。';

create index if not exists idx_ma_scenario_presets_audience
  on public.ma_scenario_presets(audience, sort_order);

alter table public.ma_scenario_presets enable row level security;

-- SELECT: 認証済みユーザー全員(マスタデータなので)
create policy msp_select
  on public.ma_scenario_presets for select
  using (auth.uid() is not null);

-- INSERT/UPDATE/DELETE は service_role のみ(明示的なポリシーは作らない)

-- ============================================
-- 2. ma_scenarios(組織別の有効化状態)
-- ============================================
-- プリセットを組織が有効化すると 1 行できる。is_active=false で「未有効化 / 一時停止」。
-- trigger_days は組織側で上書き可能(プリセットのデフォルトから外れたい場合)。
create table if not exists public.ma_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  preset_id uuid not null references public.ma_scenario_presets(id) on delete cascade,
  is_active boolean not null default false,
  -- プリセットのデフォルトから上書きしたい場合に値を入れる。null ならプリセット値。
  trigger_days_override integer,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- 1 組織 × 1 プリセット で 1 行
  unique (organization_id, preset_id)
);

comment on table public.ma_scenarios is
  '組織別の MA シナリオ有効化状態。プリセット参照 + ON/OFF + 日数上書き。';

create index if not exists idx_ma_scenarios_org
  on public.ma_scenarios(organization_id);

alter table public.ma_scenarios enable row level security;

-- SELECT: 同 org の全メンバーが閲覧可
create policy ms_select
  on public.ma_scenarios for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: admin のみ
create policy ms_admin_insert
  on public.ma_scenarios for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- UPDATE: admin のみ
create policy ms_admin_update
  on public.ma_scenarios for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- DELETE: admin のみ
create policy ms_admin_delete
  on public.ma_scenarios for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_scenarios_updated_at on public.ma_scenarios;
create trigger set_ma_scenarios_updated_at
  before update on public.ma_scenarios
  for each row execute function public.set_updated_at();

-- ============================================
-- 3. ma_templates(シナリオごとの件名・本文、暗号化)
-- ============================================
-- 件名と本文 HTML はクライアントサイド暗号化のポリシーに従い、
-- AES-256-GCM("v{n}:base64url" 形式)で暗号化された text として保存。
-- 復号は API ルート / cron 内でのみ行う。
create table if not exists public.ma_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id uuid not null references public.ma_scenarios(id) on delete cascade,
  -- 暗号文(null 許容 = 未編集 = プリセットのデフォルト文面を使う)
  encrypted_subject text,
  encrypted_body text,
  updated_at timestamptz not null default now(),
  updated_by_member_id uuid references public.organization_members(id),
  created_at timestamptz not null default now(),
  -- 1 シナリオ × 1 テンプレート
  unique (scenario_id)
);

comment on table public.ma_templates is
  'MA シナリオの件名・本文(AES-256-GCM 暗号化、サーバー側でのみ復号)。';

create index if not exists idx_ma_templates_org
  on public.ma_templates(organization_id);

alter table public.ma_templates enable row level security;

-- SELECT: 同 org の全メンバーが閲覧可
create policy mt_select
  on public.ma_templates for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: admin のみ
create policy mt_admin_insert
  on public.ma_templates for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- UPDATE: admin のみ
create policy mt_admin_update
  on public.ma_templates for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- DELETE: admin のみ
create policy mt_admin_delete
  on public.ma_templates for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

drop trigger if exists set_ma_templates_updated_at on public.ma_templates;
create trigger set_ma_templates_updated_at
  before update on public.ma_templates
  for each row execute function public.set_updated_at();

-- ============================================
-- 4. ma_consent_log(配信特約の同意ログ)
-- ============================================
-- 機能ごと(email_ma / line_ma)に「いつ・誰が・どのバージョンに」同意したか、
-- 撤回したかを保持する。法令遵守を約束した記録なので追記のみ運用が望ましいが、
-- RLS は admin に絞り、UI からは追加のみ可能にする。
create table if not exists public.ma_consent_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 機能識別子。'email_ma' / 'line_ma'(将来追加)
  feature text not null check (feature in ('email_ma', 'line_ma')),
  -- 特約バージョン("1.0" のような文字列、UI 側で固定)
  consent_version text not null,
  accepted_at timestamptz not null default now(),
  accepted_by_member_id uuid not null references public.organization_members(id),
  -- 撤回時刻。null = 同意有効。
  revoked_at timestamptz,
  revoked_by_member_id uuid references public.organization_members(id),
  created_at timestamptz not null default now()
);

comment on table public.ma_consent_log is
  'MA 機能の配信特約同意ログ。feature + revoked_at IS NULL で「有効な同意」。';

create index if not exists idx_ma_consent_log_org_feature
  on public.ma_consent_log(organization_id, feature, accepted_at desc);

alter table public.ma_consent_log enable row level security;

-- SELECT: 同 org の全メンバーが閲覧可
create policy mcl_select
  on public.ma_consent_log for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: admin のみ(同意/撤回はどちらも新規行として記録する設計のため、追加のみ)
create policy mcl_admin_insert
  on public.ma_consent_log for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- UPDATE: admin のみ(撤回時に revoked_at を埋める運用のみ)
create policy mcl_admin_update
  on public.ma_consent_log for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- DELETE は意図的に許可しない(監査ログとして残す)

-- ============================================
-- プリセット投入(EMPRO 参考の求職者向け 7 シナリオ)
-- ============================================
-- key は将来 cron 側のロジックで参照するため、安定識別子として使う。
-- description は EMPRO の表現を参考にしつつ Maira 向けに調整。
-- default_trigger_days は EMPRO のデフォルトに合わせた目安。
insert into public.ma_scenario_presets
  (key, audience, channel, name, description, trigger_event, default_trigger_days, sort_order)
values
  (
    'register_meeting_promotion',
    'candidate',
    'email',
    '登録者への面談促進',
    '求職者が登録された日からN日経過し、面談日が未設定の場合に送信',
    'client_registered_no_meeting',
    3,
    10
  ),
  (
    'meeting_reminder',
    'candidate',
    'email',
    '面談前リマインド',
    '求職者の面談日のN日前にリマインドメールを送信',
    'meeting_scheduled',
    -1,
    20
  ),
  (
    'job_introduction',
    'candidate',
    'email',
    '求人紹介',
    '求職者の面談完了後N日経過し、応募がない場合に求人を紹介',
    'meeting_done_no_application',
    3,
    30
  ),
  (
    'dormant_outreach',
    'candidate',
    'email',
    '休眠求職者掘り起こし',
    '求職者との最終連絡日からN日経過した場合に再アプローチ',
    'last_contact_threshold',
    30,
    40
  ),
  (
    'after_interview_followup',
    'candidate',
    'email',
    '面接後フォロー',
    '求職者の面接確定日からN日後にフォローメールを送信',
    'interview_done',
    1,
    50
  ),
  (
    'post_placement_followup',
    'candidate',
    'email',
    '入社後フォロー',
    '求職者の入社予定日からN日後にフォローメールを送信',
    'placement_done',
    7,
    60
  ),
  (
    'birthday_greeting',
    'candidate',
    'email',
    '誕生日のあいさつ',
    '求職者の誕生日にお祝いメールを送信(関係維持目的)',
    'candidate_birthday',
    0,
    70
  )
on conflict (key) do nothing;
