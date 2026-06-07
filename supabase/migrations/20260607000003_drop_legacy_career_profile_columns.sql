-- ============================================
-- career_profiles 暗号化移行(Step 6):旧列 DROP + リネーム(破壊的)
--
-- 目的:
--   Step 2 で追加した encrypted_data_v2 (text, AES-256-GCM 暗号文) を
--   career_profiles の単一暗号化境界に昇格させる。
--   旧 encrypted_data (bytea, 平文 JSON ラップ) と encryption_iv (ダミー bytea)
--   を DROP し、encrypted_data_v2 を encrypted_data にリネームする。
--
--   これにより「平文 × エージェント行全体 select」の PII 露出リスクが解消する
--   (設計案 R9 の確定ゲート)。エージェントの linked クライアント参照ポリシー
--   (20260601000003_agency_view_linked_client_career_profile.sql) は、本マイグ
--   レーション後は復号鍵を持たないエージェントには暗号文しか返さない。
--
-- 前提(本マイグレーション適用前に必須):
--   Step 1: lib/career/conversations.ts に decodeCareerProfileBlob を実装済み
--   Step 2: encrypted_data_v2 (text NULL 許容) を追加済み
--   Step 3: saveCareerProfile を dual-write 化済み
--   Step 4: scripts/backfill-career-profile.ts で
--           pnpm backfill:career-profile --mode=both が PASS
--           (差分 0 / 検証対象 0 件でないこと / 全行 v2 NOT NULL)
--   Step 5: 読み出しを v2 優先に切替(本人経路 + lib/diagnosis/queries.ts)
--   Step 6 のコード変更:本マイグレーションと同一コミットで、
--           dual-write 停止 + decodeCareerProfileBlob の単一経路化 +
--           bytea フォールバック削除 を入れる。
--
-- このマイグレーションは破壊的(DROP COLUMN を含む):
--   - 適用前に Step 4 の verify が PASS していること
--   - 適用前に encrypted_data_v2 IS NULL の行が 0 件であること
--   この 2 つを満たさない状態で適用すると、データ復元不能になる可能性がある。
--
-- 適用先:maira-dev のみ。
-- 本番(maira-prod)への適用はリリース準備フェーズで以下のゲート付きで実施する:
--   1. 本番の pg_dump バックアップ取得
--   2. 本番に対する verify モード PASS(差分 0、全行 NOT NULL)
--   3. 適用 → 直後の動作確認
-- 上記は今回スコープ外(別タスク)。
-- ============================================

-- DROP は同一 ALTER TABLE で 2 列まとめて削除。
-- encrypted_data_v2 のリネームは DROP と同じトランザクションで安全に行えるが、
-- PostgreSQL の構文上 RENAME COLUMN は別の ALTER 文に分ける必要があるため
-- 2 文に分ける。両文は同一マイグレーション内で自動的にトランザクション化される。
alter table public.career_profiles
  drop column if exists encryption_iv,
  drop column if exists encrypted_data;

alter table public.career_profiles
  rename column encrypted_data_v2 to encrypted_data;

-- リネーム後の列に最終的なコメントを付け直す(rename ではコメントが保持されるが、
-- 移行完了の経緯を明示的に記録するため上書きする)。
comment on column public.career_profiles.encrypted_data is
  '本文 JSON({user_facts, strengths, values, wants, concerns, summary, diagnosis?})を AES-256-GCM で暗号化した文字列("v{n}:base64url" 形式)。lib/career/conversations.ts の saveCareerProfile / decodeCareerProfileBlob が読み書き境界。鍵は env FIELD_ENCRYPTION_KEYS で管理。';
