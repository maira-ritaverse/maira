-- =====================================================================
-- delete_team に force フラグを追加
--
-- 背景:
--   現状の delete_team は 割当 client の有無に関わらず即 cascade 削除。
--   大量割当されているリスト表を誤って消すと業務影響が大きい。
--
-- 修正:
--   p_force boolean default false 引数を追加。
--   p_force = false かつ 割当 client >= 1 なら 例外 'team_has_clients:count=N' を raise。
--   p_force = true なら現状動作 (cascade 削除)。
--   route 側は 1 回目 (force なし) で 409 を返し、UI で「N件割当あり、強制削除しますか」
--   の再確認 → force=true で再送する 2 段階フロー。
--
-- 破壊的変更:
--   force を渡さない DELETE が割当ありで失敗するようになる。
--   UI (teams-admin-client.tsx) と route を同時に更新すること。
-- =====================================================================

create or replace function public.delete_team(
  p_team_id uuid,
  p_force boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_team_org_id uuid;
  v_assignment_count int;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_members
    where user_id = v_caller_user_id
      and organization_id = v_caller_org_id
      and role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 対象リスト表 を FOR UPDATE でロック (並行削除の曖昧さを回避)
  select organization_id into v_team_org_id
  from public.organization_teams
  where id = p_team_id
  for update;

  if v_team_org_id is null or v_team_org_id <> v_caller_org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- force=false の場合、割当件数チェック。 1 件でもあれば例外で拒否。
  if not p_force then
    select count(*) into v_assignment_count
    from public.client_team_assignments
    where team_id = p_team_id;

    if v_assignment_count > 0 then
      raise exception 'team_has_clients:count=%', v_assignment_count using errcode = 'P0001';
    end if;
  end if;

  delete from public.organization_teams
  where id = p_team_id
    and organization_id = v_caller_org_id;
end;
$$;

comment on function public.delete_team(uuid, boolean) is
  'リスト表を削除。 p_force=false (デフォルト) で割当 client が 1 件でもあれば '
  '''team_has_clients:count=N'' 例外で拒否。 p_force=true で強制削除 (cascade)。';
