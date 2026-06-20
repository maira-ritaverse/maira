-- ============================================
-- LINE 経由 面談 日程候補 提案 (line_meeting_proposals)
--
-- 役割:
--   ・エージェント が 求職者 に LINE で 候補 日時 を 提示
--   ・求職者 が ボタン タップ → postback で 確定 → Zoom 招待 自動送信
--
-- 候補 は jsonb に [{ startsAt, endsAt }, ...] 形式 で 保存。
-- 確定 すると consumed_slot_index に index を 記録 + created_meeting_schedule_id を セット。
--
-- 有効期限 (default 7 日):過ぎたら postback は 拒否 (= 期限切れ メッセージ を Reply)。
-- ============================================

create table if not exists public.line_meeting_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  line_user_id text not null,
  client_record_id uuid references public.client_records(id) on delete set null,

  -- 発行者 (エージェント側)
  created_by_user_id uuid not null references auth.users(id) on delete set null,

  -- 提案内容
  title text not null,
  encrypted_agenda text,  -- 議題 / 説明 (機密 = 暗号化)
  duration_minutes int not null default 30 check (duration_minutes between 5 and 480),

  -- 候補 日時 [{ startsAt: ISO, endsAt: ISO }, ...]
  candidates jsonb not null,

  -- 有効期限
  expires_at timestamptz not null,

  -- 消費 (確定 or キャンセル)
  consumed_at timestamptz,
  consumed_slot_index int,
  /** 「別の日時」を 選んだ 場合 は -1 を 入れて 確定なし扱い */
  consumed_meeting_schedule_id uuid references public.meeting_schedules(id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.line_meeting_proposals is
  'LINE 経由 で 求職者 に 提案 した 面談 日程候補。 postback で 1 つ 選択 されたら Zoom 会議 を 作成。';

create index if not exists idx_lmp_org_user_active
  on public.line_meeting_proposals (organization_id, line_user_id)
  where consumed_at is null;

create index if not exists idx_lmp_expires
  on public.line_meeting_proposals (expires_at)
  where consumed_at is null;

-- RLS
alter table public.line_meeting_proposals enable row level security;

-- SELECT: 同 org メンバー
drop policy if exists lmp_select on public.line_meeting_proposals;
create policy lmp_select on public.line_meeting_proposals for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は service_role 経由 のみ。
