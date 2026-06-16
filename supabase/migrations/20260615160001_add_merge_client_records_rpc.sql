-- =====================================================================
-- 顧客レコードのマージ(merge_client_records)
--
-- 重複検出で見つかった 2 件を 1 件に統合する。source の関連レコード(対応履歴 /
-- タスク / 応募 / 監査 / MA 送信 / 閲覧記録)を全て target へ付け替えて、source を削除する。
--
-- 設計:
--   - SECURITY DEFINER の単一 RPC でトランザクション境界を 1 つにまとめる
--     (失敗時はロールバックされる)。
--   - 認可:呼び出し元が admin 且つ source / target ともに同組織であることを必須化。
--   - client_view_states の主キーは (user_id, client_record_id)。同じ user が
--     source と target の両方を見ていた場合は重複になるので、先に「target を見ている」
--     ユーザの source 側の閲覧記録を削除してから UPDATE する。
--   - マージ操作は client_audit_log に専用フィールド名 'merge_from' で残す。
-- =====================================================================

create or replace function public.merge_client_records(
  source_id uuid,
  target_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_org uuid;
  caller_role text;
  caller_member_id uuid;
  source_org uuid;
  target_org uuid;
begin
  -- 認証 + 組織取得
  caller_org := public.current_user_organization_id();
  caller_role := public.current_user_organization_role();

  if caller_org is null then
    raise exception 'Not authenticated as an organization member';
  end if;
  if caller_role <> 'admin' then
    raise exception 'Admin role required for merge operation';
  end if;
  if source_id = target_id then
    raise exception 'Source and target are the same client';
  end if;

  -- 操作者の member.id を取得(監査ログ用)
  select id into caller_member_id
    from public.organization_members
    where user_id = auth.uid()
      and organization_id = caller_org
    limit 1;

  -- 両方とも自組織か確認
  select organization_id into source_org from public.client_records where id = source_id;
  select organization_id into target_org from public.client_records where id = target_id;

  if source_org is null then
    raise exception 'Source client not found';
  end if;
  if target_org is null then
    raise exception 'Target client not found';
  end if;
  if source_org <> caller_org or target_org <> caller_org then
    raise exception 'Cannot merge clients across organizations';
  end if;

  -- 1) 関連レコードを target へ付け替え
  update public.client_interactions set client_record_id = target_id where client_record_id = source_id;
  update public.agency_tasks set client_record_id = target_id where client_record_id = source_id;
  update public.referrals set client_record_id = target_id where client_record_id = source_id;
  update public.client_audit_log set client_record_id = target_id where client_record_id = source_id;
  update public.ma_send_logs set client_record_id = target_id where client_record_id = source_id;

  -- client_view_states は主キー (user_id, client_record_id) があるので、
  -- 同 user が target も見ていれば source 側を捨ててから UPDATE する。
  delete from public.client_view_states
    where client_record_id = source_id
      and user_id in (
        select user_id from public.client_view_states where client_record_id = target_id
      );
  update public.client_view_states set client_record_id = target_id where client_record_id = source_id;

  -- 2) 監査ログにマージ操作を記録(field_name = 'merge_from' で識別)
  insert into public.client_audit_log (
    organization_id, client_record_id, actor_member_id, action, field_name, old_value, new_value
  )
  values (
    caller_org, target_id, caller_member_id, 'update', 'merge_from', source_id::text, null
  );

  -- 3) source を削除
  delete from public.client_records where id = source_id;
end;
$$;

comment on function public.merge_client_records(uuid, uuid) is
  '顧客レコードのマージ(admin 限定、組織内のみ)。source の関連レコードを target に付け替えて source を削除する';
