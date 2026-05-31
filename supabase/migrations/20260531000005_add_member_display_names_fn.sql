-- ============================================
-- 組織メンバーの表示名を取得する SECURITY DEFINER 関数
--
-- 背景:
--   クライアント一覧画面で「担当アドバイザー名」を表示したいが、
--   profiles テーブルの RLS は「自分のプロフィールのみ閲覧可」のため、
--   通常クエリでは他メンバーの display_name を取得できない。
--
-- 対策:
--   SECURITY DEFINER 関数で組織内メンバーの (member_id, display_name) のみを
--   返す。auth.uid() が指定 organization_id のメンバーであることを内部で検証し、
--   別組織のメンバー情報は一切返さない(テナント分離を維持)。
--
-- なぜ profiles の RLS を緩めないか:
--   profiles は暗号化マスターキーなど機微情報を持つテーブル。
--   RLS を緩めると影響範囲が広いため、display_name のみを返す
--   限定的な関数で済ませる方が安全。
-- ============================================

create or replace function public.list_organization_member_display_names(
  target_organization_id uuid
)
returns table (
  member_id uuid,
  display_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    om.id as member_id,
    p.display_name
  from public.organization_members om
  left join public.profiles p on p.id = om.user_id
  where om.organization_id = target_organization_id
    -- 呼び出し元が同じ組織のメンバーである場合のみ返す
    and target_organization_id = public.current_user_organization_id();
$$;

comment on function public.list_organization_member_display_names(uuid) is
  '指定組織のメンバーの (member_id, display_name) を返す。'
  '呼び出し元が同組織メンバーでない場合は 0 件。'
  'profiles の RLS を緩めずに display_name のみを安全に公開するためのヘルパー。';
