-- =====================================================================
-- line_user_links.last_activity_at + トリガー による 自動 メンテナンス
--
-- 目的:
--   ・「N 日 連絡 なし」 の 検知 を 効率 化 (cron が 高速 に 走る)
--   ・conversation UI / CRM 一覧 の 「赤 バッジ」 判定 も この 列 を 参照
--
-- 定義:
--   last_activity_at = greatest(
--       line_user_links.created_at,
--       max(line_messages.created_at) for same (organization_id, line_user_id)
--   )
--
-- メンテナンス:
--   ・line_messages への INSERT トリガー で last_activity_at を 更新
--   ・handleFollow で は line_user_links.upsert が created_at を 更新 する 際 に
--     last_activity_at も 一緒 に セット する (RLS 側 で は 別途 保守 不要)
-- =====================================================================

-- 1. カラム 追加 (default は created_at 相当 = 現在時刻 の 保険 値)
alter table public.line_user_links
  add column if not exists last_activity_at timestamptz not null default now();

comment on column public.line_user_links.last_activity_at is
  '最終 活動 時刻 (LINE 友達 追加 or メッセージ 送受信 の 最新)。 N 日 連絡 なし の 検知 用。 トリガー で 自動 更新。';

-- 2. インデックス (「N 日 連絡 なし」 の 一括 抽出 高速 化)
create index if not exists idx_line_user_links_stale
  on public.line_user_links (organization_id, last_activity_at)
  where handled_at is null and unfollowed_at is null;

-- 3. 既存 データ の backfill
--    max(line_messages.created_at) を greatest で 保険 に 挟む
update public.line_user_links l
   set last_activity_at = greatest(
     l.created_at,
     coalesce(
       (select max(m.created_at)
          from public.line_messages m
         where m.organization_id = l.organization_id
           and m.line_user_id   = l.line_user_id),
       l.created_at
     )
   );

-- 4. line_messages INSERT トリガー で last_activity_at を 更新
create or replace function public.update_line_user_last_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.line_user_links
     set last_activity_at = greatest(last_activity_at, new.created_at)
   where organization_id = new.organization_id
     and line_user_id   = new.line_user_id;
  return new;
end;
$$;

comment on function public.update_line_user_last_activity() is
  'line_messages への INSERT で line_user_links.last_activity_at を 更新 する トリガー 関数。';

drop trigger if exists trg_line_messages_update_last_activity on public.line_messages;
create trigger trg_line_messages_update_last_activity
  after insert on public.line_messages
  for each row
  execute function public.update_line_user_last_activity();
