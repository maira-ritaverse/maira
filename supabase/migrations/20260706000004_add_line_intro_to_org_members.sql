-- =====================================================================
-- エージェント (organization_members) 用 の 「LINE 自己 紹介」 カラム を 追加
--
-- 目的:
--   ・エージェント が 自分 の プロフィール (顔 写真 + ヘッド ライン + 本文) を
--     Maira 内 に 登録
--   ・LINE 会話 で 「自己 紹介 を 送信」 ボタン から 顧客 に 送れる
--
-- 設計:
--   ・per (user_id, organization_id) = 組織 単位 で 別 プロフィール 保持 可能
--     (稀 に 副業 で 別 org に 所属 する ケース を 想定)
--   ・本文 は 「思い」 や 経歴 が 含 まれる ため 暗号化。 ヘッド ライン は 表示
--     用 で 短く、 検索 対象 に なる 可能性 も 想定 して 平文。
--   ・写真 は avatar-images バケット 内 の 別 プレフィックス
--     ( line-intro/{organization_id}/{user_id}/{ts}.jpg ) を 使う。
--
-- RLS:
--   既存 organization_members の RLS が そのまま 適用 (自分 の 行 のみ 編集)。
-- =====================================================================

alter table public.organization_members
  add column if not exists line_intro_headline text,
  add column if not exists encrypted_line_intro_body text,
  add column if not exists line_intro_photo_storage_path text,
  add column if not exists line_intro_updated_at timestamptz;

-- ヘッド ライン は 120 字 まで (LINE の 送信 上限 と 過剰 な 長 さ を 抑制)
alter table public.organization_members
  drop constraint if exists org_members_line_intro_headline_len_check;
alter table public.organization_members
  add constraint org_members_line_intro_headline_len_check
  check (line_intro_headline is null or char_length(line_intro_headline) <= 120);

comment on column public.organization_members.line_intro_headline is
  'LINE 自己 紹介 の 短い 見出し (氏名 + 肩書 等)。 120 字 まで、 平文。';

comment on column public.organization_members.encrypted_line_intro_body is
  'LINE 自己 紹介 の 本文 (経歴 + 思い 等)。 暗号化 済み (v{n}:base64url) 形式。';

comment on column public.organization_members.line_intro_photo_storage_path is
  'LINE 自己 紹介 用 の 顔 写真 の Storage パス (avatar-images バケット 内)。';

comment on column public.organization_members.line_intro_updated_at is
  '最終 更新 時刻 (headline / body / photo の いずれか の 更新 で セット)。';
