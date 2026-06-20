-- ============================================
-- LINE 添付ファイル 用 Storage バケット
--
-- 用途:
--   ・LINE で 求職者 が 送信 した 画像 / 動画 / 音声 / ファイル を 保存
--   ・将来 エージェント が LINE に 送信 する 画像 も ここ
--
-- パス 構造:
--   line-attachments/{organization_id}/{line_user_id}/{message_id}_{filename}
--   storage.foldername(name)[1] = organization_id
--
-- 設計判断:
--   ・private バケット (URL 漏洩で 他人に 見られない)
--   ・配信 は API 経由 で 署名URL を 発行 (有効期間 5 分)
--   ・書き込み は service_role のみ
--     (webhook 受信 → LINE Content API → Storage 保存 の フロー)
--   ・読み込み は 同 org メンバー
--     (storage.foldername(name)[1] が 自組織 と マッチ)
-- ============================================

-- 1) line-attachments バケット
insert into storage.buckets (id, name, public)
values ('line-attachments', 'line-attachments', false)
on conflict (id) do nothing;

-- 2) Storage RLS
--
-- SELECT: 同 org メンバー が、 自組織 配下 の パス を 閲覧可
create policy "line_attachments_select_org_member"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'line-attachments'
    and (storage.foldername(name))[1] = public.current_user_organization_id()::text
  );

-- INSERT / UPDATE / DELETE は service_role 経由のみ。
-- (Webhook ハンドラ が service_role で 動く ため、 ポリシーは 不要 = 暗黙拒否)
