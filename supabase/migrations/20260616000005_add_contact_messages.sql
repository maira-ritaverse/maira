-- =====================================================================
-- LP / アプリ内からの問い合わせを保存する受信箱テーブル
--
-- 既存:
--   app/api/contact/route.ts は Resend でメール送信のみで、DB には残していなかった。
--   → BtoBtoC 運用に切り替わり「運営者の作業負荷」「対応漏れ」を防ぐため、
--     ここで履歴化する。メール送信は引き続き行う(リアルタイム通知 + バックアップ)。
--
-- セキュリティ:
--   - INSERT は service_role のみ(API route 側で書き込み、anon に晒さない)
--   - SELECT / UPDATE は profiles.is_maira_admin=true の運営者のみ
--   - DELETE は無し(ログとして残す)
--
-- 注意:
--   - 個人情報を含む(氏名 / メアド / 会社名 / 本文)
--   - 暗号化はしない(運営者が頻繁に検索する性質。RLS で保護)
--   - GDPR / 個人情報保護法対応の削除請求は audit_log + 手動削除で対応(将来)
-- =====================================================================

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  name text not null,
  email text not null,
  message text not null,
  ip_address inet,
  user_agent text,
  -- 既読 / メモ(運営者が後から付ける)
  read_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.contact_messages is
  'LP 問い合わせフォーム / アプリ内サポートの受信箱(運営者のみ閲覧)';

create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc);
create index if not exists contact_messages_unread_idx
  on public.contact_messages (read_at)
  where read_at is null;

alter table public.contact_messages enable row level security;

-- 運営者のみ閲覧
drop policy if exists contact_messages_admin_select on public.contact_messages;
create policy contact_messages_admin_select
  on public.contact_messages
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_maira_admin = true
    )
  );

-- 運営者のみ既読 / メモ更新
drop policy if exists contact_messages_admin_update on public.contact_messages;
create policy contact_messages_admin_update
  on public.contact_messages
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_maira_admin = true
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_maira_admin = true
    )
  );

-- INSERT は service_role のみ(明示的に policy を作らないことで anon を遮断)
