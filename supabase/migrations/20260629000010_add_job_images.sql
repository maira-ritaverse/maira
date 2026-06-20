-- ============================================
-- 求人 画像 機能
--
-- 目的:
--   ・求人 票 に メイン 画像 を 設定 (求人 詳細 画面 / リスト で 表示)
--   ・LINE 配信 用 に 別 画像 を 設定 (なければ メイン に fallback)
--
-- 設計:
--   ・列 は Storage の path (`{org_id}/{job_id}/{kind}.{ext}`) を 保存
--   ・LINE Flex の hero に 画像 URL を 直接 渡す 必要 が ある の で、
--     バケット は public (誰 でも GET できる)
--   ・書き込み 系 (INSERT/UPDATE/DELETE) は エージェント メンバー のみ
--   ・LINE 配信 で 画像 URL が 友達 全員 に 渡る 性質 上、 公開 性 は OK
--
-- パス 構造:
--   job-images/{organization_id}/{job_id}/hero.{ext}
--   job-images/{organization_id}/{job_id}/line.{ext}
--   foldername(name)[1] = organization_id
-- ============================================

-- 1. 列 追加 (Storage path を 保存)
alter table public.job_postings
  add column if not exists hero_image_path text,
  add column if not exists line_share_image_path text;

comment on column public.job_postings.hero_image_path is
  '求人 メイン 画像 の Storage パス (job-images バケット 配下)。';
comment on column public.job_postings.line_share_image_path is
  'LINE 配信 用 画像 の Storage パス。 nullable で、 null 時 は hero_image_path に fallback。';

-- 2. job-images バケット を public で 作成
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-images',
  'job-images',
  true,
  5242880,  -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- 3. Storage RLS:同 organization の メンバー だけ が、 自 org の パス 配下 を
--    INSERT / UPDATE / DELETE できる。 SELECT は public バケット なので 不要。

-- INSERT:組織 メンバー の み
drop policy if exists "job_images_insert_org" on storage.objects;
create policy "job_images_insert_org"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-images'
    and (storage.foldername(name))[1]::uuid = public.current_user_organization_id()
  );

-- UPDATE:組織 メンバー の み
drop policy if exists "job_images_update_org" on storage.objects;
create policy "job_images_update_org"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'job-images'
    and (storage.foldername(name))[1]::uuid = public.current_user_organization_id()
  )
  with check (
    bucket_id = 'job-images'
    and (storage.foldername(name))[1]::uuid = public.current_user_organization_id()
  );

-- DELETE:組織 メンバー の み
drop policy if exists "job_images_delete_org" on storage.objects;
create policy "job_images_delete_org"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-images'
    and (storage.foldername(name))[1]::uuid = public.current_user_organization_id()
  );
