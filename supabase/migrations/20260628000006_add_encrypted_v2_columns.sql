-- ============================================
-- 機密フィールドの AES-256-GCM 暗号化への移行(v2 カラム追加)
--
-- 背景:
--   ・applications.encrypted_details / tasks.encrypted_title /
--     tasks.encrypted_description / messages.encrypted_content は
--     当初「bytea に AES 暗号文を格納」する設計だったが、暗号化未実装の
--     まま平文 UTF-8 を bytea に書き込む暫定状態で運用されていた。
--   ・CLAUDE.md「機密フィールドは必ず AES-256-GCM で暗号化する」に違反。
--
-- 方針:
--   ・encryptField / decryptField の入出力は "v{n}:base64url(...)" 形式の text。
--     bytea 列に直接書き込めない(エンコード不一致)ため、新規に _v2 (text)
--     カラムを追加し、コードと データ を そちらに 移行する。
--   ・既存 bytea カラムは互換のため残し、後続マイグレーションでドロップ。
--
-- このマイグレーションでやること:
--   1. _v2 (text) カラムを追加(nullable)
--   2. 既存 bytea を UTF-8 復号して _v2 に コピー
--      (この時点では 平文。decryptField はプレフィックス無しを そのまま 返す
--       フォールバックを持つので、読み出しは破綻しない)
--   3. 旧 bytea カラムの NOT NULL を解除
--      (新コードが旧カラムに書き込まないようにするため。デフォルト値は不要)
--   4. 別途バックフィルスクリプトで _v2 を AES-256-GCM で暗号化し直す
--      (Postgres には Maira の鍵が無いので、Node スクリプトで実施)
-- ============================================

-- 1. v2 (text) カラム追加 ----------------------------------------------------
alter table public.applications
  add column if not exists encrypted_details_v2 text;

alter table public.tasks
  add column if not exists encrypted_title_v2 text;

alter table public.tasks
  add column if not exists encrypted_description_v2 text;

alter table public.messages
  add column if not exists encrypted_content_v2 text;

-- 2. 既存 bytea を v2 に コピー(平文のまま) -----------------------------------
-- convert_from は bytea を 指定エンコーディング(UTF-8)の text に 変換する。
-- 既存データは UTF-8 で書き込まれているので そのまま 読み戻せる。
update public.applications
  set encrypted_details_v2 = convert_from(encrypted_details, 'UTF8')
  where encrypted_details_v2 is null
    and encrypted_details is not null;

update public.tasks
  set encrypted_title_v2 = convert_from(encrypted_title, 'UTF8')
  where encrypted_title_v2 is null
    and encrypted_title is not null;

update public.tasks
  set encrypted_description_v2 = convert_from(encrypted_description, 'UTF8')
  where encrypted_description_v2 is null
    and encrypted_description is not null;

update public.messages
  set encrypted_content_v2 = convert_from(encrypted_content, 'UTF8')
  where encrypted_content_v2 is null
    and encrypted_content is not null;

-- 3. 旧 bytea カラム + encryption_iv の NOT NULL 解除 -------------------------
-- 新コードは bytea 側 / encryption_iv に 書き込まなくなる(暗号化は v2 text 列
-- に AES-GCM IV を 同梱する形になるため)。INSERT で 値を 渡さなくても 通るよう
-- NOT NULL を 外す。
alter table public.applications
  alter column encrypted_details drop not null,
  alter column encryption_iv drop not null;

alter table public.tasks
  alter column encrypted_title drop not null,
  alter column encryption_iv drop not null;

alter table public.messages
  alter column encrypted_content drop not null,
  alter column encryption_iv drop not null;

-- 注意:タスク description / 会話タイトル は 元々 nullable なので 触らない。

comment on column public.applications.encrypted_details_v2 is
  'AES-256-GCM 暗号文(v{n}:base64url)。encrypted_details (bytea) からの移行先。';
comment on column public.tasks.encrypted_title_v2 is
  'AES-256-GCM 暗号文(v{n}:base64url)。encrypted_title (bytea) からの移行先。';
comment on column public.tasks.encrypted_description_v2 is
  'AES-256-GCM 暗号文(v{n}:base64url)。encrypted_description (bytea) からの移行先。';
comment on column public.messages.encrypted_content_v2 is
  'AES-256-GCM 暗号文(v{n}:base64url)。encrypted_content (bytea) からの移行先。';
