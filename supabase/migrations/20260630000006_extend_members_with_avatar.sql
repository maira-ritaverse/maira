-- =====================================================================
-- list_organization_members_with_meta に avatar_storage_path を 追加
--
-- 経緯:
--   20260630000005 で profiles.avatar_storage_path を 追加 した が、 メンバー
--   一覧 等 から アバター 画像 を 表示 する に は 同 org の 他 メンバー の
--   avatar_storage_path を 取得 する 必要 が ある。 profiles テーブル の
--   SELECT RLS は 「自分 の 行 のみ」 に 限定 さ れて いる ため、 既存 の
--   SECURITY DEFINER RPC を 使う 経路 を そのまま 拡張 する。
--
-- 変更:
--   ・returns table に avatar_storage_path text 列 を 追加
--   ・select 句 で p.avatar_storage_path を 出力
--   ・returns table の シグネチャ 変更 の ため、 まず drop してから create
-- =====================================================================

drop function if exists public.list_organization_members_with_meta(uuid);

create or replace function public.list_organization_members_with_meta(
  target_organization_id uuid
)
returns table (
  member_id uuid,
  user_id uuid,
  role text,
  display_name text,
  email text,
  avatar_storage_path text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    om.id as member_id,
    om.user_id,
    om.role,
    p.display_name,
    u.email::text as email,
    p.avatar_storage_path,
    om.created_at
  from public.organization_members om
  left join public.profiles p on p.id = om.user_id
  left join auth.users u on u.id = om.user_id
  where om.organization_id = target_organization_id
    -- 呼び出し元が同じ組織のメンバーである場合のみ返す
    and target_organization_id = public.current_user_organization_id();
$$;

comment on function public.list_organization_members_with_meta(uuid) is
  '指定組織のメンバー一覧 (member_id, user_id, role, display_name, email, avatar_storage_path, created_at)。'
  '呼び出し元が同組織メンバーでない場合は 0 件。'
  'auth.users.email と profiles.avatar_storage_path を 安全 に 同 org 内 でのみ 公開 する ため の ヘルパー。';
