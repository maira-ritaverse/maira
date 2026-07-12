-- ============================================
-- organizations に BYO Resend の設定を追加
--
-- 案 B: 各エージェント企業が自分の Resend アカウント + API キー + 独自ドメインを
-- 持ち込む(Bring-Your-Own)。 課金 / DNS / レピュテーションは各社の責任。
--
-- 設計:
--   ・resend_api_key_encrypted:AES-256-GCM で暗号化して保存(平文で保存しない)
--   ・email_from:公開情報(送信元アドレス)なので平文
--   ・両方 nullable。 未設定なら Maira の env RESEND_API_KEY / EMAIL_FROM に
--     フォールバック(旧挙動と後方互換)
-- ============================================

alter table public.organizations
  add column if not exists resend_api_key_encrypted text,
  add column if not exists email_from text;

comment on column public.organizations.resend_api_key_encrypted is
  '各社の Resend API キーを AES-256-GCM で暗号化した文字列(v{n}:base64url 形式)。 未設定なら Maira の env にフォールバック。';
comment on column public.organizations.email_from is
  '各社の送信元メールアドレス(例: recruit@abc-agency.co.jp)。 Resend 側で verify 済みのドメインである必要がある。';
