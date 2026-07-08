-- =====================================================================
-- テナント 分離 の defense-in-depth 強化 (監査 M7 + M8)
--
-- M7. client_record_collaborators INSERT policy が member_id の 組織 所属 を 検証 しない。
--     現状 は WITH CHECK が client_record 側 org のみ 検証。 Org A admin が
--     supabase-js 直叩き で 別 org の member_id を 差し込め る 状態。 副担当 driven な
--     通知 / 集計 が 増え た 瞬間 に クロス テナント リーク が 顕在化 する ため 予防。
--
-- M8. client_records UPDATE policy が linked_user_id / link_status / linked_at /
--     revoked_at を advisor から 直 変更 可能。 API は zod で 弾く が RLS 直叩き で
--     通せる。 「advisor が 担当 外 顧客 を 自 seeker アカウント に 紐付け → career
--     profile 等 に 到達」 の 経路 を BEFORE UPDATE トリガ で 塞ぐ。
-- =====================================================================

-- ============================================
-- M7: collaborators INSERT policy に member org 一致 を 追加
-- ============================================
drop policy if exists client_record_collaborators_insert on public.client_record_collaborators;
create policy client_record_collaborators_insert on public.client_record_collaborators
  for insert
  with check (
    exists (
      select 1 from public.client_records cr
       where cr.id = client_record_id
         and cr.organization_id = public.current_user_organization_id()
    )
    and exists (
      select 1 from public.organization_members om
       where om.id = member_id
         and om.organization_id = public.current_user_organization_id()
    )
  );

comment on policy client_record_collaborators_insert on public.client_record_collaborators is
  'INSERT は 自 org の client_record + 自 org の member 両方 の 組み合わせ のみ。 M7 修正。';

-- ============================================
-- M8: client_records の linked_user_id / link_status / linked_at / revoked_at を
--     service_role 以外 の UPDATE で 変更 させ ない BEFORE トリガ
-- ============================================
create or replace function public.enforce_client_records_link_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role による 変更 (Webhook / RPC 経由 の 招待 受諾 等) は 通す
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- 以下 4 列 は authenticated ユーザー からの 直 UPDATE を 禁止 する。
  -- 招待 受諾 / 連携 解除 は accept_invitation / revoke 系 の RPC (SECURITY DEFINER)
  -- 経由 で のみ 更新 可能。
  if new.linked_user_id is distinct from old.linked_user_id then
    raise exception 'linked_user_id is immutable via direct update' using errcode = '42501';
  end if;
  if new.link_status is distinct from old.link_status then
    raise exception 'link_status is immutable via direct update' using errcode = '42501';
  end if;
  if new.linked_at is distinct from old.linked_at then
    raise exception 'linked_at is immutable via direct update' using errcode = '42501';
  end if;
  if new.revoked_at is distinct from old.revoked_at then
    raise exception 'revoked_at is immutable via direct update' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.enforce_client_records_link_immutable() is
  'client_records の 連携 系 列 (linked_user_id / link_status / linked_at / revoked_at) を advisor 直 UPDATE から 保護。 M8 修正。';

drop trigger if exists trg_client_records_link_immutable on public.client_records;
create trigger trg_client_records_link_immutable
  before update on public.client_records
  for each row
  execute function public.enforce_client_records_link_immutable();
