-- =====================================================================
-- deactivate_member RPC の 情報 漏洩 面 を 塞ぐ (defense-in-depth)
--
-- 従来 実装 の 問題:
--   ・target_member_id で 先 に SELECT し、 その 後 で 別 org の 場合 に
--     'forbidden'、 存在 しない 場合 に 'not_found' を raise して いた。
--   ・悪 意 の ある admin が 任意 UUID を 送り 込む と、 「別 org に 存在 する
--     行 か」 「そもそも 存在 しない UUID か」 を エラー コード で 判別 でき、
--     組織 メンバー UUID の 存在 有無 が オラクル に なる。
--   ・現実 の 攻撃 面 は UUID の 総 当り 困難 で 小さい が、 defense-in-depth の
--     観点 で 統一 する。
--
-- 修正 方針:
--   ・SELECT の WHERE 句 に 「own org」 の 条件 を 直接 入れる。
--   ・行 が 見つから ない (別 org or 存在 しない) 場合 は 常 に 'not_found'。
--   ・呼び出し 側 admin の 認証 / 権限 チェック は 従来 通り 事前 に 実施。
--
-- 参考: 同じ 順序 問題 は change_member_role RPC に も あるが、 別 PR で 対応。
-- =====================================================================

create or replace function public.deactivate_member(
  target_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_role text;
  v_caller_member_id uuid;
  v_target_role text;
  v_admin_count int;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    raise exception 'not_org_member' using errcode = '42501';
  end if;

  -- 呼び出し 側 は admin だけ 削除 可
  select role, id into v_caller_role, v_caller_member_id
    from public.organization_members
   where user_id = v_caller_user_id
     and organization_id = v_caller_org_id
   limit 1;

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 対象 メンバー を 「同 org」 制約 付き で 引く。
  -- 別 org の UUID を 送り 込まれ て も、 存在 しない UUID を 送り 込まれ て も
  -- 同じ NULL に なる の で エラー コード が オラクル に ならない。
  select role into v_target_role
    from public.organization_members
   where id = target_member_id
     and organization_id = v_caller_org_id
   for update;

  if v_target_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 最後 の admin は 削除 拒否
  if v_target_role = 'admin' then
    select count(*) into v_admin_count
      from public.organization_members
     where organization_id = v_caller_org_id
       and role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  -- 削除 (関連 FK は on delete cascade / set null で 掃除 済)
  delete from public.organization_members
   where id = target_member_id
     and organization_id = v_caller_org_id;

  -- 監査 ログ
  insert into public.member_audit_log (
    organization_id,
    target_member_id,
    action,
    changed_by_member_id,
    detail
  ) values (
    v_caller_org_id,
    target_member_id,
    'member_removed',
    v_caller_member_id,
    jsonb_build_object('removed_role', v_target_role)
  );

  return target_member_id;
end;
$$;

comment on function public.deactivate_member(uuid) is
  'メンバー 削除 の 集約 RPC。 同 組織 admin 限定、 最後 の admin は 削除 不可、 監査 ログ を 残す。 別 org UUID も 「not_found」 統一 で 情報 漏洩 面 を 塞ぐ。';
