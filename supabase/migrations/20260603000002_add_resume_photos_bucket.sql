-- 履歴書写真用の Storage バケットと RLS
--
-- なぜ private バケットなのか:
--   顔写真は個人情報。URL が漏れても他人が閲覧できないように、
--   public バケットではなく private にして、署名付きURLでのみ
--   配信する設計にする。
--
-- パス構造:
--   resume-photos/{user_id}/{resume_id}/{filename}
--   storage.foldername(name)[1] = user_id となるため、
--   本人(auth.uid())判定にこれを使う。
--
-- photo_url(暗号化PII)には Storage のパスだけを格納し、
-- 表示・PDF出力時に署名付きURLを都度発行する(別ステップで実装)。

-- 1) resume-photos バケットを作成(private)
insert into storage.buckets (id, name, public)
values ('resume-photos', 'resume-photos', false)
on conflict (id) do nothing;

-- 2) Storage RLS:本人(auth.uid())だけが、自分のパス配下に
--    SELECT / INSERT / UPDATE / DELETE できる

-- SELECT:本人のみ閲覧可
create policy "resume_photos_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'resume-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- INSERT:本人のみアップロード可
create policy "resume_photos_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'resume-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- UPDATE:本人のみ上書き可
create policy "resume_photos_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'resume-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'resume-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- DELETE:本人のみ削除可
create policy "resume_photos_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'resume-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
