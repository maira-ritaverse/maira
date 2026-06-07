-- ============================================
-- 開示フロー Phase 6(P3):revoke_client_link を申請モードに置き換え
--
-- 背景:
--   P1+P2(20260607000010 / 20260607000011)で revoke_requested 状態と
--   時刻条件付き開示経路を整えた。P3 では本人の解除を「即時解除」から
--   「申請(linked → revoke_requested)」に置き換える。
--
--   既存 RPC revoke_client_link(20260607000005)は linked → revoked へ
--   即時遷移する作りだったが、本マイグレーションで挙動を以下に変更する:
--     - linked → revoke_requested
--     - revoke_requested_at = now() を打刻
--     - revoke_deadline = now() + (organizations.revoke_grace_days * interval '1 day')
--       を打刻して固定(後から組織設定の grace_days が変更されても
--       進行中の申請には影響しない)
--
-- なぜ命名を維持するか:
--   API パス /api/me/links/[id]/revoke と UI コンポーネント名(RevokeConnectionButton)を
--   維持することで、外部呼び先(将来のモバイル統合等)と内部コードへの影響を最小化する。
--   P3 以降「本人の解除経路は申請のみ」になるため、revoke という単語が「申請」を意味する
--   形に拡張されるのは概念的に問題ない(エージェント側の承認 RPC は別命名で新設予定)。
--
-- 認可・遷移検証:
--   - 認可: linked_user_id = auth.uid()(linked 後にメール変更されても通す設計を踏襲)
--   - 遷移: linked 以外からは invalid_state(revoke_requested → revoke_requested の
--     重複申請も弾かれる)
--   - FOR UPDATE ロックで二重申請を直列化
--   - エラー体系は P2 RPC 群に揃える:
--       unauthenticated  (42501)
--       forbidden        (42501)
--       not_found        (P0002)
--       invalid_state    (P0001)
--
-- 取り下げ:
--   申請取り下げ(revoke_requested → linked)は今回のスコープ外(方針未確定)。
--   別 Phase で要否を検討する。
-- ============================================

create or replace function public.revoke_client_link(
  p_client_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_linked_user_id uuid;
  v_link_status text;
  v_org_id uuid;
  v_grace_days int;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 対象行をロック(申請の二重実行や他 RPC との競合を直列化)
  select linked_user_id, link_status, organization_id
    into v_linked_user_id, v_link_status, v_org_id
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_link_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- linked 以外からの申請は不可。
  -- revoke_requested(重複申請)/ revoked / invited / unlinked のいずれもここで止まる。
  if v_link_status <> 'linked' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- 本人確認:確定済み linked_user_id で見る(メール一致ではなく)
  if v_linked_user_id is null or v_linked_user_id <> v_caller_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 組織の猶予日数を取得
  -- organizations.revoke_grace_days は P1 で NOT NULL + default 14 + CHECK(7..90) を
  -- 入れているため通常 NULL にはならないが、防御的に NULL なら default 14 にフォールバック
  -- (FK 不整合等のエッジケースでも申請が落ちないように)。
  select revoke_grace_days into v_grace_days
  from public.organizations
  where id = v_org_id;

  if v_grace_days is null then
    v_grace_days := 14;
  end if;

  update public.client_records
  set link_status = 'revoke_requested',
      revoke_requested_at = now(),
      -- 申請時点で deadline を固定打刻。以後 organizations.revoke_grace_days が
      -- 変わっても本行の deadline は不変(進行中の申請に影響させない設計)。
      revoke_deadline = now() + make_interval(days => v_grace_days),
      updated_at = now()
  where id = p_client_record_id;
end;
$$;

comment on function public.revoke_client_link(uuid) is
  '二段階解除 P3:本人(linked_user_id = auth.uid())が linked 状態のクライアント連携を '
  'revoke_requested に遷移させる(解除を申請する)。'
  'revoke_requested_at = now() / revoke_deadline = now() + grace_days を打刻して固定。'
  '即時 revoked にはせず、承認(エージェント・P4)or タイムアウト(cron・P6)で revoked に確定する。'
  'P3 以前は linked → revoked 即時遷移だったが、本マイグレーションで申請モードに置き換え。'
  '関数名は API/UI への影響を抑えるため維持。';
