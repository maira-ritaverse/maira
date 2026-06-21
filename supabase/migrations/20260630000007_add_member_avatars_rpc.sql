-- =====================================================================
-- list_organization_member_avatars: 同 org メンバー の avatar 一覧
--
-- 既存 の list_organization_member_display_names は 6+ caller で 戻り 値 が
-- 固定 列 で 使われて いる ため、 シグネチャ 変更 は 影響 大。 アバター 専用 の
-- 別 RPC を 用意 し、 必要 な 画面 (タスク 担当 / 対応 履歴 / 担当 者 セレクト
-- 等) で 並列 fetch + Map merge する 形 で 段階 適用 する。
--
-- 認可: SECURITY DEFINER で profiles の RLS を バイパス。 ただし
--       呼び出し 元 が 「target_organization_id = 自 org」 で ある こと を
--       current_user_organization_id() で 検証 (他組織 の avatar を 漏らさ ない)。
-- =====================================================================

create or replace function public.list_organization_member_avatars(
  target_organization_id uuid
)
returns table (
  member_id uuid,
  user_id uuid,
  avatar_storage_path text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    om.id as member_id,
    om.user_id,
    p.avatar_storage_path
  from public.organization_members om
  left join public.profiles p on p.id = om.user_id
  where om.organization_id = target_organization_id
    and target_organization_id = public.current_user_organization_id();
$$;

comment on function public.list_organization_member_avatars(uuid) is
  '同 org メンバー の avatar_storage_path (member_id, user_id, avatar_storage_path) を 返す。 '
  '呼び出し 元 が 同 org メンバー で ない 場合 は 0 件。 '
  'profiles の SELECT RLS (自分 のみ) を バイパス する ため の 専用 helper。';

grant execute on function public.list_organization_member_avatars(uuid) to authenticated;
