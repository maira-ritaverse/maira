-- =====================================================================
-- LINE Webhook イベントの冪等台帳を追加(M3 修正)
--
-- 背景:
--   LINE は at-least-once 配信で、同一イベントを再送し得る(deliveryContext.
--   isRedelivery)。message は line_messages(organization_id, line_message_id)
--   の unique で二重防止されるが、follow / unfollow / postback は line_message_id
--   を持たない(system 行は line_message_id=NULL で NULL は衝突しない)ため、
--   再送で「友達追加」「興味あり」system メッセージの二重挿入・通知の二重 fan-out・
--   MA フローの二重 enroll が起き得た。
--
--   全イベントが持つ webhookEventId を PK に記録し、既処理なら以降スキップする。
--
-- セキュリティ:
--   webhook(service_role)からのみ読み書きする内部台帳。stripe_events と同様に
--   RLS を有効化しつつユーザー向けポリシーは作らない(= 一般ユーザーは一切触れず、
--   service_role のみ RLS をバイパスして操作)。auth.uid ベースのポリシーは
--   user_id を持たないこの台帳には不適なので付けない。
-- =====================================================================

create table if not exists public.line_webhook_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_event_id text not null,
  event_type text,
  processed_at timestamptz not null default now(),
  primary key (organization_id, webhook_event_id)
);

comment on table public.line_webhook_events is
  'LINE Webhook の idempotency 台帳。webhookEventId を PK に二重処理を防ぐ(follow/unfollow/postback は line_message_id を持たないため必要)。';

-- 古い行の定期削除(将来の cron 用)に備えたインデックス。
create index if not exists idx_line_webhook_events_processed_at
  on public.line_webhook_events (processed_at);

alter table public.line_webhook_events enable row level security;
-- ポリシーは作らない(service_role 専用の内部台帳。一般ユーザーはアクセス不可)。
