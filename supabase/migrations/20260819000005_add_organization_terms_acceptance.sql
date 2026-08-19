-- =====================================================================
-- エージェント組織の利用規約同意を organizations に記録
--
-- 背景:
--   エージェントが本サービスを初めて利用する際、組織の管理者が代表して NDA と
--   利用規約の両方に同意(タイプ署名)する運用にする。NDA と同じ複合同意ゲートで
--   同時に署名し、同意時に署名済みの控え(PDF)を署名者の登録メールに送付する。
--
--   NDA(20260819000004)と同様に per-organization で organizations に記録する。
--   バージョン(= 利用規約の最終更新日)が上がると再同意が必要になる(lib/terms で判定)。
--
--   書き込みは consent accept API が service_role で行う(管理者本人であることを
--   API 側で検証したうえで組織行を更新する)。
-- =====================================================================

alter table public.organizations
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists terms_signer_name text,
  add column if not exists terms_signer_user_id uuid references auth.users(id),
  add column if not exists terms_signer_ip text;

comment on column public.organizations.terms_accepted_at is '利用規約に同意した日時(NULL=未同意)。';
comment on column public.organizations.terms_version is '同意した利用規約のバージョン(lib/terms/terms-content.ts の CURRENT_TERMS_VERSION)。';
comment on column public.organizations.terms_signer_name is '利用規約 署名者の氏名(タイプ署名)。';
comment on column public.organizations.terms_signer_user_id is '利用規約に同意した管理者ユーザーの id。';
comment on column public.organizations.terms_signer_ip is '利用規約 同意時の IP アドレス(署名の証跡)。';
