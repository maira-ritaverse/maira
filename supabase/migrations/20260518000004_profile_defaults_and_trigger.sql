-- ============================================
-- profiles テーブルの調整とトリガー設置
--
-- 目的:
-- 1. 暗号化必須カラムに暫定デフォルトを設定(Week 3で本実装)
-- 2. auth.usersへの新規ユーザー追加時、profilesを自動作成
-- ============================================

-- ============================================
-- 1. 暗号化必須カラムに暫定デフォルトを追加
--
-- Week 3でクライアントサイド暗号化を本実装する際に、
-- このダミー値はリアルな暗号化キーで上書きされる
-- ============================================
alter table public.profiles
  alter column encrypted_master_key set default '\x00'::bytea,
  alter column encrypted_master_key_by_recovery set default '\x00'::bytea,
  alter column password_salt set default '\x00'::bytea;

-- ============================================
-- 2. profile自動作成trigger
--
-- auth.usersへの新規ユーザー追加時に、
-- 対応するprofilesレコードを自動的に作成する
-- ============================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users への新規追加時に profiles レコードを自動作成する';

-- triggerをauth.usersに設置
-- 注意: auth.users は Supabase 所有のため `comment on trigger` は権限不足で実行できない
-- (must be owner of relation users)。トリガー自体の作成は許可されている。
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================
-- 3. profileのRLSポリシー追加
--
-- triggerはsecurity definerで動くため別途設定不要だが、
-- ユーザー自身が後でdisplay_name等を更新できるように
-- INSERT/UPDATEポリシーは既にタスク#005で設定済み
-- ============================================
