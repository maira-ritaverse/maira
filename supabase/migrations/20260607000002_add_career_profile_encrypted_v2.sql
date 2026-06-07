-- ============================================
-- career_profiles 暗号化移行(Step 2):本物の暗号文を入れる列を追加
--
-- 目的:
--   現状の encrypted_data (bytea) は名前に反して平文 JSON を bytea で
--   ラップしただけの暫定形式。lib/career/conversations.ts に書かれていた
--   「Week 3 で本実装」のタイミング。
--
--   resumes.encrypted_pii / cvs.encrypted_body と同じ AES-256-GCM パターンに
--   揃えるため、新カラム encrypted_data_v2 (text) を追加する。
--   lib/crypto/field-encryption.ts の "v{n}:base64url(iv ‖ ciphertext+authTag)"
--   形式の暗号文を 1 本のテキスト列に格納する設計。
--
-- 移行ステップ全体:
--   Step 1(完了):lib/career/conversations.ts に hybrid decode ヘルパーを追加
--   Step 2(本マイグレーション):列追加(NULL 許容、破壊なし)
--   Step 3:書き込み側を encrypted_data_v2 に切替(コードのみ)
--   Step 4:dev 既存データを encrypted_data → encrypted_data_v2 にバックフィル
--   Step 5:lib/diagnosis/queries.ts の改修(エージェント診断閲覧経路)
--   Step 6:旧 encrypted_data / encryption_iv を DROP し、本列を
--           encrypted_data にリネーム(破壊的・dev で検証後に本番リリース時)
--
-- このマイグレーションの安全性:
--   - 追加のみ(DROP / 列変更 / RENAME を含まない)
--   - NULL 許容(既存行は影響を受けない)
--   - RLS は行レベルなので、career_profiles の既存 4 ポリシー
--     (本人 select/insert/update + 組織メンバー linked select)が
--     そのまま新カラムにも効く。追加ポリシーは不要。
--
-- 本番(maira-prod)への適用はリリース準備フェーズで明示指示の上で別途行う。
-- 本ファイルの適用先は maira-dev のみ。
-- ============================================

alter table public.career_profiles
  add column if not exists encrypted_data_v2 text;

comment on column public.career_profiles.encrypted_data_v2 is
  '本文 JSON({user_facts, strengths, values, wants, concerns, summary, diagnosis?})を AES-256-GCM で暗号化した文字列("v{n}:base64url" 形式)。Step 6 で旧 encrypted_data / encryption_iv を DROP し、本列を encrypted_data にリネームする。移行期間中は NULL 許容(NULL = 未バックフィル行)。lib/career/conversations.ts が読み書き境界。';
