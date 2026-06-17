-- ============================================================================
-- アーカイブ(ソフト削除)機能の追加
--
-- 目的:
--   ・退会したエージェント企業を「削除」せずに履歴として残す
--   ・退会したユーザーも完全削除せず「停止」状態にする
--   ・データ整合性(referrals / interactions 等の履歴参照)を守る
--
-- カラム:
--   ・archived_at      timestamptz:null = 現役、NOT NULL = アーカイブ済み
--   ・archived_reason  text:任意のメモ(運営者の手入力)
--
-- 既存データ:
--   ・全行 archived_at = null(現役)で開始
--
-- アプリ側のルール:
--   ・archived_at が NOT NULL の組織 / プロフィールは管理画面で
--     「退会済」タブにのみ表示する
--   ・通常の listing クエリで archived_at IS NULL を条件に加える
-- ============================================================================

alter table public.organizations
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

alter table public.profiles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

-- 現役判定で使うインデックス(archived_at IS NULL を頻繁にクエリするため)
create index if not exists idx_organizations_active
  on public.organizations (created_at desc)
  where archived_at is null;

create index if not exists idx_profiles_active
  on public.profiles (id)
  where archived_at is null;

comment on column public.organizations.archived_at is
  'アーカイブ(退会済)日時。null なら現役。';
comment on column public.organizations.archived_reason is
  'アーカイブ理由(運営者の手入力メモ)';
comment on column public.profiles.archived_at is
  'アカウント停止日時。null なら現役。';
comment on column public.profiles.archived_reason is
  '停止理由(運営者の手入力メモ)';
