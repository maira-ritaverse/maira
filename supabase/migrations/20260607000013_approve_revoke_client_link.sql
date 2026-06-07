-- ============================================
-- 開示フロー Phase 6(P4):エージェントの解除承認 RPC
--
-- 背景:
--   P3(20260607000012)で本人の解除を「即時 revoked」から「申請(linked →
--   revoke_requested)」に置き換えた。本マイグレーションでは、エージェントが
--   申請を承認して revoke_requested → revoked を「即時確定」させる経路を加える。
--
-- 方針:
--   エージェントに与える権限は「承認(早く確定する)」のみ。
--   拒否・差し戻し・遅延は与えない(本人の撤回権を守るため、エージェントが
--   できるのは「承認しない」ことだけで、それは結果として猶予期限経過後の
--   自動確定(P6)で revoked になる)。
--
-- 認可・遷移検証(Phase 2 invite/cancel RPC の作りに揃える):
--   - 認可:呼び出し元が当該 client_records.organization_id のメンバーである
--     (public.current_user_organization_id() で取得し一致を確認)
--   - 状態前提:link_status = 'revoke_requested' のみ可。それ以外は invalid_state
--   - 遷移:revoke_requested → revoked
--   - 打刻:
--       revoked_at           = now()
--       revoke_confirmed_via = 'agency_approved'(確定経路の監査値)
--   - linked_user_id は履歴として残す(本人が解除済み連携を自分で確認するため。
--     既存 Phase 2 の revoke_client_link と同じ方針)
--   - FOR UPDATE ロックで二重承認・他 RPC との競合を直列化
--   - SECURITY DEFINER + set search_path = public
--   - エラー体系:unauthenticated(42501)/ forbidden(42501)/
--               not_found(P0002)/ invalid_state(P0001)
--
-- 期限切れの扱い:
--   本 RPC は now() と revoke_deadline の比較を行わない。期限切れの
--   revoke_requested を「承認」して即時 revoked にするケースは UX 上有り得ない
--   ものではない(本人視点で「もう開示は止まっている」状態を、エージェントの
--   操作で正式に revoked にする = 後始末)。期限到来後の見かけ更新は本来 P6 の
--   cron が担うが、エージェントが先に手動で揃えても問題ない。開示自体は
--   P1+P2 の時刻条件で deadline 経過時点から既に止まっている。
-- ============================================

create or replace function public.approve_revoke_client_link(
  p_client_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_client_org_id uuid;
  v_link_status text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 対象行をロック(承認の二重実行を直列化)
  select organization_id, link_status
    into v_client_org_id, v_link_status
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_client_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 呼び出しエージェントが当該クライアントの自組織メンバーであること
  -- (current_user_organization_id は SECURITY DEFINER stable、Phase 2 で導入済み)
  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null or v_caller_org_id <> v_client_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 承認できるのは revoke_requested 状態のみ
  -- (linked / unlinked / invited / revoked のいずれもここで止まる。
  -- 二重承認(revoked への再承認)も invalid_state で弾かれる)
  if v_link_status <> 'revoke_requested' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.client_records
  set link_status = 'revoked',
      revoked_at = now(),
      revoke_confirmed_via = 'agency_approved',
      updated_at = now()
  where id = p_client_record_id;
end;
$$;

comment on function public.approve_revoke_client_link(uuid) is
  '二段階解除 P4:エージェントが revoke_requested の解除申請を承認して revoked に即時確定。'
  '認可は呼び出し元の自組織メンバー判定。revoked_at = now() / revoke_confirmed_via = ''agency_approved'' を打刻。'
  '拒否・差し戻しは方針として作らない(エージェントは早く確定できるだけで、しない場合は '
  '期限経過の自動確定(P6 cron)で revoked になる)。';
