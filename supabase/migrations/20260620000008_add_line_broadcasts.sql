-- ============================================
-- LINE 一斉配信 (line_broadcasts)
--
-- Multicast API:
--   POST /v2/bot/message/multicast {to: [...max 500], messages: [...]}
--   配信数 = 課金 通数 (友達 全員 = 全員分 課金)
--
-- 集計 / 分析 用:
--   ・sent_count / failed_count を 配信完了後 に 更新
--   ・target_filter で ターゲット選定 を 保存 (再利用 / 分析 用)
--   ・status (queued / sending / sent / failed)
--
-- 機密:
--   ・encrypted_content: 配信 本文 (Flex JSON or text)
-- ============================================

create table if not exists public.line_broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  -- 発行者
  created_by_user_id uuid not null references auth.users(id) on delete set null,

  -- 配信内容
  encrypted_content text not null,
  message_type public.line_message_type not null,

  -- ターゲット 設定 (jsonb で 柔軟に):
  --   {"kind": "all"}                        — 全 友達 (unfollowed 除外)
  --   {"kind": "linked"}                     — client_record 紐付け 済 のみ
  --   {"kind": "unlinked"}                   — 未紐付け のみ
  target_filter jsonb not null,
  target_count int not null,

  -- ステータス
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed')),
  sent_count int not null default 0,
  failed_count int not null default 0,
  scheduled_for timestamptz,
  sent_at timestamptz,

  -- エラー サマリ (失敗時)
  error_message text,

  created_at timestamptz not null default now()
);

comment on table public.line_broadcasts is
  'LINE 一斉配信 (Multicast) 履歴 + 配信統計。 課金通数 = sent_count。';

create index if not exists idx_line_broadcasts_org_created
  on public.line_broadcasts (organization_id, created_at desc);

-- RLS
alter table public.line_broadcasts enable row level security;

drop policy if exists lb_select on public.line_broadcasts;
create policy lb_select on public.line_broadcasts for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE は service_role 経由 のみ
