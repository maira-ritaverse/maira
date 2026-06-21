-- ============================================
-- ユーザー アバター 画像
--
-- 目的:
--   ・エージェント (organization_member) が 自分 の アバター を 設定 し、
--     組織 管理者 が メンバー 一覧 / タスク 担当 / 対応 履歴 等 で 顔写真 で
--     識別 し やすく する
--   ・将来 求職者 (seeker) にも 開放 する 可能性 が ある ため、 列 は profiles
--     共通 と し、 Storage パス も user_id 起点 で 設計
--
-- 設計:
--   ・列 profiles.avatar_storage_path text は Storage の path を 保存
--   ・バケット avatar-images は public (誰 でも GET 可)
--     - サイドバー / アバター 表示 等 で 多 箇所 から 参照 さ れる ため、 署名
--       URL より 直 URL の 方 が シンプル + キャッシュ も 効く
--     - 顔写真 自体 は 「同 組織 メンバー に は 見え る」 設計 で、 完全 非公開
--       が 必要 な 場面 は ない
--   ・パス: avatar-images/{user_id}/avatar-{epochms}.{ext}
--     foldername(name)[1] = user_id
-- ============================================

-- 1. 列 追加
alter table public.profiles
  add column if not exists avatar_storage_path text;

comment on column public.profiles.avatar_storage_path is
  'アバター 画像 の Storage パス (avatar-images バケット 配下)。 null = 未設定 (フォールバック で 表示名 / メール 頭文字 を 出す)。';

-- 2. avatar-images バケット を public で 作成
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatar-images',
  'avatar-images',
  true,
  2097152,  -- 2 MiB (アイコン サイズ で 充分)
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- 3. Storage RLS:
--    SELECT は public バケット なので ポリシー 不要 (誰 でも GET 可)。
--    INSERT / UPDATE / DELETE は 「自分 (auth.uid()) の フォルダ」 のみ。

drop policy if exists "user_avatars_insert_self" on storage.objects;
create policy "user_avatars_insert_self"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

drop policy if exists "user_avatars_update_self" on storage.objects;
create policy "user_avatars_update_self"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  )
  with check (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

drop policy if exists "user_avatars_delete_self" on storage.objects;
create policy "user_avatars_delete_self"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );
