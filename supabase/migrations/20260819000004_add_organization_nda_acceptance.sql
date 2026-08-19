-- =====================================================================
-- エージェント組織の NDA(秘密保持契約)同意を organizations に記録
--
-- 背景:
--   エージェントが本サービスを初めて利用する際、組織の管理者が代表して NDA に
--   同意(タイプ署名)する運用にする。同意するまでエージェント画面をブロックし、
--   同意時に署名済み NDA(PDF)を署名者の登録メールに送付する。
--
--   privacy policy(profiles.privacy_policy_accepted_at)の per-user 方式に倣い、
--   NDA は per-organization で organizations に記録する。バージョンが上がると
--   再同意が必要になる(lib/nda で判定)。
--
--   書き込みは accept API が service_role で行う(管理者本人であることを API 側で
--   検証したうえで組織行を更新する)。
-- =====================================================================

alter table public.organizations
  add column if not exists nda_accepted_at timestamptz,
  add column if not exists nda_version text,
  add column if not exists nda_signer_name text,
  add column if not exists nda_signer_user_id uuid references auth.users(id),
  add column if not exists nda_signer_ip text;

comment on column public.organizations.nda_accepted_at is 'NDA に同意した日時(NULL=未同意)。';
comment on column public.organizations.nda_version is '同意した NDA のバージョン(lib/nda/nda-content.ts の CURRENT_NDA_VERSION)。';
comment on column public.organizations.nda_signer_name is 'NDA 署名者の氏名(タイプ署名)。';
comment on column public.organizations.nda_signer_user_id is 'NDA に同意した管理者ユーザーの id。';
comment on column public.organizations.nda_signer_ip is 'NDA 同意時の IP アドレス(署名の証跡)。';
