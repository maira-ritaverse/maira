-- =====================================================================
-- プライバシーポリシー同意の記録(個人情報保護法 第18条 / 第20条 対応)
--
-- 設計:
--   - profiles に同意日時 + 同意時のバージョンを保持
--   - バージョンはアプリ側 lib/privacy/policy.ts の CURRENT_PRIVACY_POLICY_VERSION と一致
--   - プライバシーポリシー改訂時はバージョン文字列を更新 → 既存ユーザは再同意が必要になる
--   - 同意イベントは audit_logs にも privacy_policy_accepted で残す(法令対応)
--
-- 既存ユーザ:NULL のまま → アプリ側で「未同意 / 古いバージョン」と判定して再同意モーダル表示。
-- =====================================================================

alter table public.profiles
  add column if not exists privacy_policy_accepted_at timestamptz,
  add column if not exists privacy_policy_version text;

comment on column public.profiles.privacy_policy_accepted_at is
  'プライバシーポリシー同意日時。NULL なら未同意。';
comment on column public.profiles.privacy_policy_version is
  '同意したプライバシーポリシーのバージョン文字列(例:2026-06-15)。';

-- 同意済バージョンの集計に使う軽量インデックス(運営者の集計向け)
create index if not exists profiles_policy_version_idx
  on public.profiles (privacy_policy_version);
