-- =====================================================================
-- メンバー権限 RPC の呼び出し元ルックアップをハードニング(クロステナント昇格の是正)
--
-- 背景:
--   change_member_role / change_member_permission は SECURITY DEFINER 関数で、
--   関数内で「呼び出しユーザー = 対象組織の admin」を検証してから role / 権限を書き換える。
--
--   ・change_member_role は 20260708000003 で既に current_user_organization_id()
--     (removed_at 除外)経由で caller org を解決し、caller / target を org スコープ済み。
--     ただし caller の role を引く SELECT が removed_at を絞っておらず、同一組織で
--     「除名 → 別 role で再追加」された場合に removed 行の role を拾い得る残存があった。
--     加えて last-admin カウントが removed_at を除外しておらず、除名済み admin を数えて
--     最後の現役 admin を降格許可 → 組織ロックアウトしうる潜在バグもあった。
--   ・change_member_permission は最後に適用された版(20260708000003)が、存在しない列
--     `organization_members.member_permissions`(JSONB)へ UPDATE する未完成の再設計に
--     書き換わっていた。実際の権限は member_permissions "テーブル" に保存され、読み取り
--     パス(lib/organizations/members.ts / queries.ts)もテーブルを見る。このため
--     2026-07-08 以降、権限トグル RPC は実行時に列不在エラー(42703)→ ルートで 500 に
--     なっていた(export 権限の付与/剥奪が一切効かない)。さらに旧々版(20260630000012)は
--     caller ルックアップが `where user_id = auth.uid() limit 1`(org 未固定・removed_at
--     未フィルタ)で、旧組織で除名済みの admin 行が採用され得るクロステナント昇格もあった。
--
-- 対応:
--   ・両関数の呼び出し元解決を「current_user_organization_id() で active な所属組織を取得 →
--     その組織内の removed_at IS NULL の admin 行のみを caller とみなす」形に統一。
--   ・change_member_permission は member_permissions "テーブル" への upsert + 監査ログ +
--     invalid_key / target_admin ガードを持つ版(= ルートの例外マッピングと整合する
--     20260630000012 相当)に戻し、上記の 500 バグも同時に解消する。
--   ・change_member_role は last-admin カウントにも removed_at IS NULL を追加。
--   ふるまい(戻り値・例外コード・監査ログ列)は「本来の正しい版」と互換で、認可の穴と
--   500 バグだけを塞ぐ。
--
-- 適用: まず dev(maira-dev)で検証。prod への適用はリリース時に別途明示指示で行う。
-- =====================================================================

-- ---------------------------------------------------------------------
-- change_member_role: caller の role SELECT に removed_at IS NULL を追加
--   (org 解決は current_user_organization_id() で既に removed 除外済み。
--    同一組織内の removed 行の role を拾わないよう明示フィルタする。)
--   本体ロジック(last-admin 検証・org スコープ・監査ログ)は 20260708000003 と同一。
-- ---------------------------------------------------------------------
create or replace function public.change_member_role(
  target_member_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_target_role text;
  v_admin_count int;
begin
  if new_role not in ('admin', 'advisor') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 呼び出し元の role は「現役(removed_at IS NULL)」の行のみから引く
  select role into v_caller_role
    from public.organization_members
   where user_id = v_caller_user_id
     and organization_id = v_caller_org_id
     and removed_at is null
   limit 1;
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 「同 org 制約 付き」 SELECT: 別 org の UUID は 存在 して も 「not_found」 で 統一
  select role into v_target_role
    from public.organization_members
   where id = target_member_id
     and organization_id = v_caller_org_id
   for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_target_role = 'admin' and new_role = 'advisor' then
    select count(*) into v_admin_count
      from public.organization_members
     where organization_id = v_caller_org_id
       and role = 'admin'
       and removed_at is null;
    if v_admin_count <= 1 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  update public.organization_members
     set role = new_role,
         updated_at = now()
   where id = target_member_id
     and organization_id = v_caller_org_id;

  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail
  ) values (
    v_caller_org_id,
    target_member_id,
    'role_changed',
    jsonb_build_object('from', v_target_role, 'to', new_role)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- change_member_permission: 最後に適用された版(20260708000003)は存在しない列へ
--   UPDATE していて権限トグルが 500 だった。member_permissions "テーブル" への upsert +
--   監査ログ + invalid_key / target_admin ガードを持つ正しい版に戻し、caller ルックアップも
--   current_user_organization_id() + removed_at フィルタ + org スコープに統一する。
--   例外コード(invalid_key/forbidden/not_found/target_admin)はルート
--   app/api/agency/members/[id]/permissions/route.ts のマッピングと一致。
--   引数名(uuid, p_permission_key text, boolean)は既存と同一のため CREATE OR REPLACE 可。
-- ---------------------------------------------------------------------
create or replace function public.change_member_permission(
  target_member_id uuid,
  p_permission_key text,
  granted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_member_id uuid;
  v_caller_role text;
  v_caller_org_id uuid;
  v_target_role text;
begin
  -- 現状は export のみ。 将来 追加 したら IN リスト に 追記
  if p_permission_key not in ('export') then
    raise exception 'invalid_key' using errcode = '22023';
  end if;

  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 呼び出し元は「現役(removed_at IS NULL)admin」のみ。旧実装は org 未固定・
  -- removed_at 未フィルタで、他組織の除名済み admin 行を採用し得た(クロステナント昇格)。
  select id, role into v_caller_member_id, v_caller_role
    from public.organization_members
   where user_id = v_caller_user_id
     and organization_id = v_caller_org_id
     and removed_at is null
   limit 1;
  if v_caller_member_id is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- target は同 org 制約付き(別 org の UUID は存在しても not_found で統一)
  select role into v_target_role
    from public.organization_members
   where id = target_member_id
     and organization_id = v_caller_org_id
   for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- admin は 常 に 全 権限 を 持つ ため、 トグル 不可
  if v_target_role = 'admin' then
    raise exception 'target_admin' using errcode = 'P0001';
  end if;

  insert into public.member_permissions (
    organization_id,
    member_id,
    permission_key,
    granted,
    granted_by_member_id,
    updated_at
  ) values (
    v_caller_org_id,
    target_member_id,
    p_permission_key,
    granted,
    v_caller_member_id,
    now()
  )
  on conflict (member_id, permission_key) do update set
    granted = excluded.granted,
    granted_by_member_id = excluded.granted_by_member_id,
    updated_at = now();

  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    detail,
    changed_by_member_id
  ) values (
    v_caller_org_id,
    target_member_id,
    case when granted then 'permission_grant' else 'permission_revoke' end,
    jsonb_build_object('permission_key', p_permission_key),
    v_caller_member_id
  );
end;
$$;
