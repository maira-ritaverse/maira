-- ============================================
-- 開示フロー Phase 6(P2):開示経路を二段階解除に対応(時刻条件化)
--
-- 背景:
--   20260607000010 で revoke_requested 状態と revoke_deadline 列を追加した。
--   本マイグレーションは、エージェント側の書類/希望条件開示と求職者本人の
--   閲覧経路を「linked または(revoke_requested かつ revoke_deadline > now())」
--   の条件で組み替える。期限超過した revoke_requested は全開示経路で遮断され、
--   撤回権の安全弁が cron なしでも RLS / RPC レベルで成立する。
--
-- 変更対象(調査報告 A5 のうち時刻条件が必要な経路):
--   1. resumes:エージェント SELECT(20260607000007)を時刻条件付きに差し替え
--   2. cvs    :エージェント SELECT(20260607000007)を時刻条件付きに差し替え
--   3. organizations:求職者本人 SELECT(20260607000007)に revoke_requested を
--                   追加(本人が連携先名を見るだけなので時刻条件は不要)
--   4. client_records:本人「Linked seeker」(20260531000001)を revoke_requested
--                   も含めるように差し替え(申請中セクションを本人 UI に出すため)
--   5. RPC get_linked_client_encrypted_career_profile(20260607000009 が最新)を
--      時刻条件付きで差し替え
--
-- 不変な経路:
--   - career_profiles のエージェント開示は Phase 1 で撤去済(20260607000004)。
--     新ポリシーは足さない(エージェントは引き続き 5 の RPC 経由のみ)。
--   - "Invited seeker can view their own client record by email"(20260607000005)
--     と "Revoked seeker can view their own client record"(20260607000006)は
--     状態が独立なので無変更。
--   - 同組織メンバーの client_records SELECT(20260531000001)は link_status
--     による絞り込みをしておらず、全状態が見えるので無変更。
-- ============================================

-- ============================================
-- 1. resumes:linked または期限内 revoke_requested の自組織クライアントのみ可
--
-- 期限超過した revoke_requested は revoke_deadline > now() の評価が false に
-- なるため自動で開示が止まる(cron 不要の安全弁)。
-- ============================================
drop policy if exists "Org members can view linked client resumes"
  on public.resumes;

create policy "Org members can view linked client resumes"
  on public.resumes for select
  using (
    user_id in (
      select linked_user_id from public.client_records
      where linked_user_id is not null
        and (
          link_status = 'linked'
          or (
            link_status = 'revoke_requested'
            and revoke_deadline is not null
            and revoke_deadline > now()
          )
        )
        and organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
        )
    )
  );

comment on policy "Org members can view linked client resumes" on public.resumes is
  '開示フロー Phase 6。linked または期限内 revoke_requested の自組織クライアントの '
  '履歴書のみ select 可。期限超過した revoke_requested は now() 評価で自動遮断。'
  'INSERT/UPDATE/DELETE は本人限定の既存ポリシーで不変。';

-- ============================================
-- 2. cvs:linked または期限内 revoke_requested の自組織クライアントのみ可
-- ============================================
drop policy if exists "Org members can view linked client cvs"
  on public.cvs;

create policy "Org members can view linked client cvs"
  on public.cvs for select
  using (
    user_id in (
      select linked_user_id from public.client_records
      where linked_user_id is not null
        and (
          link_status = 'linked'
          or (
            link_status = 'revoke_requested'
            and revoke_deadline is not null
            and revoke_deadline > now()
          )
        )
        and organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
        )
    )
  );

comment on policy "Org members can view linked client cvs" on public.cvs is
  '開示フロー Phase 6。linked または期限内 revoke_requested の自組織クライアントの '
  '職務経歴書のみ select 可。期限超過した revoke_requested は now() 評価で自動遮断。'
  'INSERT/UPDATE/DELETE は本人限定の既存ポリシーで不変。';

-- ============================================
-- 3. organizations:求職者本人が当事者の組織を見る経路に revoke_requested を追加
--
-- ここは「本人が自分の連携先の組織名を見るだけ」なので時刻条件は不要。
-- 期限超過後も状態は revoke_requested のまま「自分が関わった組織名」が見える。
-- 期限超過時の書類/希望条件遮断は 1 / 2 / 5 の時刻条件で実現する。
-- ============================================
drop policy if exists "Seeker can view organizations they are connected with"
  on public.organizations;

create policy "Seeker can view organizations they are connected with"
  on public.organizations for select
  using (
    id in (
      select organization_id from public.client_records
      where (
        link_status = 'invited'
        and lower(trim(email)) = public.current_user_email()
      ) or (
        linked_user_id = auth.uid()
        and link_status in ('linked', 'revoke_requested', 'revoked')
      )
    )
  );

comment on policy "Seeker can view organizations they are connected with" on public.organizations is
  '開示フロー Phase 6。求職者が、招待を受けた(メール一致 invited)または '
  '連携した/申請中/解除した(linked_user_id 一致 linked|revoke_requested|revoked)'
  'client_records 行に紐づく organization のみ select 可。'
  '時刻条件は不要(本人が連携先名を見るだけ。書類等の開示遮断は別経路で担保)。';

-- ============================================
-- 4. client_records:本人「Linked seeker」を revoke_requested も含めて差し替え
--
-- 既存「Linked seeker can view their own client record」(20260531000001)は
-- link_status='linked' のみだったが、申請中(revoke_requested)状態の自分の
-- 行も本人に見えないと、connections UI で「申請中」セクションを出せない。
--
-- ここは時刻条件を入れず「linked または revoke_requested」を本人に見せる。
-- 期限超過後も自分の申請状態を本人が確認できる必要があるため。
-- 期限超過時の書類/希望条件の遮断は 1 / 2 / 5 の時刻条件で別途担保される。
--
-- revoked 行は別ポリシー(20260607000006 "Revoked seeker can view their own
-- client record")で本人に開示済みのため、ここには含めない(過剰合成を避ける)。
-- ============================================
drop policy if exists "Linked seeker can view their own client record"
  on public.client_records;

create policy "Linked seeker can view their own client record"
  on public.client_records for select
  using (
    linked_user_id = auth.uid()
    and link_status in ('linked', 'revoke_requested')
  );

comment on policy "Linked seeker can view their own client record" on public.client_records is
  '開示フロー Phase 6。本人が linked または revoke_requested の自分の client_records 行を select 可。'
  '期限超過後も状態は revoke_requested のまま見えるが、書類/希望条件は別経路の時刻条件で遮断される。'
  'revoked 行は "Revoked seeker can view their own client record" で開示済みのため本ポリシーには含めない。';

-- ============================================
-- 5. RPC get_linked_client_encrypted_career_profile:時刻条件付きで差し替え
--
-- 既存(20260607000009)は link_status='linked' のみ通していた。
-- 期限内 revoke_requested も通し、期限超過は forbidden で弾く。
-- 状態遷移を伴わない読み取り専用 / stable は維持
-- (now() は stable 関数内で安全に呼べる:トランザクション開始時刻を返す)。
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
  v_revoke_deadline timestamptz;
  v_encrypted text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 読み取り専用なので FOR SHARE / FOR UPDATE は使わない(stable 維持のため)。
  select organization_id, link_status, linked_user_id, revoke_deadline
    into v_client_org_id, v_link_status, v_linked_user_id, v_revoke_deadline
  from public.client_records
  where id = p_client_record_id;

  if v_client_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 呼び出しエージェントが当該クライアントの自組織メンバーであること
  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null or v_caller_org_id <> v_client_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- linked_user_id が確定していない場合は問答無用で拒否
  if v_linked_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 開示してよい条件:
  --   - linked            … そのまま許可
  --   - revoke_requested  … 期限内(revoke_deadline > now())のみ許可
  -- それ以外(invited / unlinked / revoked / 期限超過 revoke_requested)は forbidden。
  -- 期限超過した revoke_requested は誰もアクセスしなくても now() 評価で
  -- 自動的に拒否されるため、cron が無くても撤回権の安全弁が成立する。
  if v_link_status = 'linked' then
    null;
  elsif v_link_status = 'revoke_requested'
        and v_revoke_deadline is not null
        and v_revoke_deadline > now() then
    null;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 暗号文を取得。career_profiles 未作成なら null を返す(Phase 5 と同じ挙動)。
  select encrypted_data into v_encrypted
  from public.career_profiles
  where user_id = v_linked_user_id;

  return v_encrypted;
end;
$$;

comment on function public.get_linked_client_encrypted_career_profile(uuid) is
  '開示フロー Phase 6。エージェントが linked または期限内 revoke_requested の '
  '自組織クライアントの career_profile 暗号文を取得する。'
  '期限超過した revoke_requested は forbidden で弾かれる(撤回権の安全弁)。'
  'career_profile 未作成なら null を返す。SECURITY DEFINER / stable。';
