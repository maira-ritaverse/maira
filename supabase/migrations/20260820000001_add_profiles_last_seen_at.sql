-- =====================================================================
-- profiles.last_seen_at: ユーザーの「最終アクセス」精度を高めるための列
--
-- 背景:
--   運営者(/admin)の「最終ログイン」は auth.users.last_sign_in_at を出していた。
--   ただし last_sign_in_at は「明示的なサインイン時」にしか更新されず、
--   セッション中のトークン自動更新や日々の利用では更新されない。
--   その結果「最後にサインインしてから毎日使っている人」でも数週間前のまま表示され、
--   最終アクセスの精度が悪かった。
--
--   そこで、認証後レイアウト(/app, /agency)の表示ごとに last_seen_at を更新し
--   (5 分スロットルで書き込み負荷を抑える)、運営者画面では
--   GREATEST(last_sign_in_at, last_seen_at) を「最終アクセス」として表示する。
--
--   書き込みは after() の中で service_role(createServiceClient)から本人 id に対して
--   のみ行う。RLS は変更しない(サービスロールでバイパスするため)。
-- =====================================================================

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  '認証後レイアウト表示時に更新される最終アクセス時刻(5 分スロットル)。運営者画面で last_sign_in_at と合わせて「最終アクセス」を算出する。';
