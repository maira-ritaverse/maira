-- ============================================
-- Phase 5 fix:get_linked_client_encrypted_career_profile から FOR SHARE を外す
--
-- 背景:
--   20260607000008 で同関数を stable / SECURITY DEFINER として作ったが、
--   client_records 取得時に `FOR SHARE` を付けていた。Postgres は stable / immutable
--   関数の中で行ロック(FOR UPDATE / FOR SHARE)を許可しないため、関数呼び出しが
--   "SELECT FOR SHARE is not allowed in a non-volatile function" で失敗していた。
--
--   本関数は状態遷移を伴わない読み取り専用なので、行ロックは不要。FOR SHARE を
--   削除して通常の SELECT に変更する(stable はそのまま維持し、プランナの結果
--   キャッシュを引き続き効かせる)。
--
-- 適用方針:
--   既存マイグレーション 20260607000008 はそのまま残し(dev に適用済み)、
--   本ファイルで create or replace function により関数本体を上書きする。
--   "既存マイグレーションを編集しない / 新規ファイルを追加する" 運用ルールに沿う。
-- ============================================

create or replace function public.get_linked_client_encrypted_career_profile(
  p_client_record_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_client_org_id uuid;
  v_link_status text;
  v_linked_user_id uuid;
  v_encrypted text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 状態遷移を伴わない読み取り専用なので、FOR SHARE / FOR UPDATE は使わない。
  -- 関数を stable に保つことでプランナの結果キャッシュが効く。
  select organization_id, link_status, linked_user_id
    into v_client_org_id, v_link_status, v_linked_user_id
  from public.client_records
  where id = p_client_record_id;

  if v_client_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null or v_caller_org_id <> v_client_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_link_status <> 'linked' or v_linked_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select encrypted_data into v_encrypted
  from public.career_profiles
  where user_id = v_linked_user_id;

  return v_encrypted;
end;
$$;
