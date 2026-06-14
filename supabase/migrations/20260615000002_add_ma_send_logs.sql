-- ============================================
-- MA 送信ログ
--
-- Edge Function(cron 駆動)が自動配信したメール 1 通ごとに 1 行記録する。
-- 「いつ・何のシナリオで・誰に・何を送ったか」「成功/失敗」を監査ログとして残し、
-- UI(送信履歴画面、未実装)から閲覧できるようにする。
--
-- 設計方針:
--   - 件名・本文は ma_templates と同じく AES-256-GCM で暗号化保存
--     (送信時の文面を改竄なく後から確認できる)
--   - 受信者メアドは client_records.email を引き継ぐが、ここでは平文で OK
--     (送信ターゲットを後から検証する用途で、client_records 側も平文のため)
--   - 書き込みは Edge Function(service_role)からのみ。アプリ UI からは書かない
--     → INSERT/UPDATE/DELETE のポリシーを意図的に作らない(service_role はバイパス)
--   - SELECT は同 org メンバー全員(エージェント業務の透明性のため)
--
-- リトライ運用:
--   失敗(status='failed')のレコードは Edge Function 側で最大 N 回再試行する。
--   毎回新しい行を作るのではなく、Edge Function 内のメモリで完結させる(行は増やさない)。
--   N 回連続失敗で初めて status='failed' のレコードを書き、エラーメッセージを残す。
-- ============================================

create table if not exists public.ma_send_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id uuid not null references public.ma_scenarios(id) on delete cascade,

  -- 受信者(client_records 側、求職者本人の auth.users では「ない」)
  -- 送信時の状態をスナップショットしたいので set null:client_records 削除後もログは残す
  recipient_client_record_id uuid references public.client_records(id) on delete set null,
  recipient_email text not null,

  -- 送信した文面(暗号化、ma_templates と同じ "v{n}:base64url" 形式)
  encrypted_subject text not null,
  encrypted_body text not null,

  -- 送信結果
  sent_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  -- 失敗時のエラーメッセージ(暗号化不要、運用情報)
  error_message text,
  -- Resend API から返ってきた message_id(成功時のみ、追跡用)
  resend_message_id text,

  created_at timestamptz not null default now()
);

comment on table public.ma_send_logs is
  'MA Edge Function による自動配信 1 通ごとの監査ログ。書き込みは service_role のみ。';
comment on column public.ma_send_logs.recipient_email is
  '送信先メールアドレス。client_records.email を引き継ぐため平文保存。';
comment on column public.ma_send_logs.status is
  'sent=送信成功 / failed=N回再試行後の最終失敗 / skipped=同意撤回・条件不一致等で送らなかった';

-- 組織+日付の検索用 / シナリオ別の集計用 / 受信者別の追跡用 の 3 通り
create index if not exists idx_ma_send_logs_org_date
  on public.ma_send_logs(organization_id, sent_at desc);
create index if not exists idx_ma_send_logs_scenario
  on public.ma_send_logs(scenario_id, sent_at desc);
create index if not exists idx_ma_send_logs_recipient
  on public.ma_send_logs(recipient_client_record_id, sent_at desc);

alter table public.ma_send_logs enable row level security;

-- SELECT: 同 org の全メンバーが閲覧可
create policy msl_select
  on public.ma_send_logs for select
  using (organization_id = public.current_user_organization_id());

-- INSERT/UPDATE/DELETE は意図的にポリシーを作らない:
--   - INSERT: Edge Function(service_role)からのみ書き込む。アプリ経由の書き込みは禁止
--   - UPDATE: 監査ログなので原則不変
--   - DELETE: 同上(必要なら organization 削除の cascade に任せる)
