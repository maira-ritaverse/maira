-- =====================================================================
-- 求職者が「応募を依頼」を表明するための RPC
--
-- 既存設計:
--   ・referrals は agency 組織メンバーのみ INSERT 可(RLS)
--   ・求職者(seeker)は通常 INSERT できない
--
-- 本マイグレーション:
--   1) request_referral_as_seeker(p_job_posting_id) RPC を追加
--      - 認可:auth.uid() が linked された client_record の linked_user_id である
--      - 重複時:既存 referral を返すだけ(unique 違反を吸収)
--      - 戻り値:referral.id
--   2) list_seeker_requested_job_ids() RPC を追加
--      - 自身が linked された client_record に紐づく referrals の job_posting_id 一覧
--      - UI でボタン状態の出し分けに使う
-- =====================================================================

create or replace function public.request_referral_as_seeker(
  p_job_posting_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_client_record_id uuid;
  v_organization_id uuid;
  v_referral_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 求人 → 組織を確定
  select jp.organization_id
    into v_organization_id
  from public.job_postings jp
  where jp.id = p_job_posting_id
    and jp.status = 'open';
  if v_organization_id is null then
    raise exception 'job_not_open_or_missing' using errcode = '22023';
  end if;

  -- 呼び出し者が「その組織に linked された client_record の linked_user_id」
  select cr.id
    into v_client_record_id
  from public.client_records cr
  where cr.organization_id = v_organization_id
    and cr.linked_user_id = v_caller
    and cr.link_status = 'linked'
  limit 1;
  if v_client_record_id is null then
    raise exception 'not_linked_to_org' using errcode = '42501';
  end if;

  -- 既存があれば返す、無ければ insert(unique 制約で並走を吸収)
  insert into public.referrals (
    organization_id, client_record_id, job_posting_id, status, notes
  ) values (
    v_organization_id,
    v_client_record_id,
    p_job_posting_id,
    'planned',
    '本人からの応募依頼(AI 推薦経由)'
  )
  on conflict (client_record_id, job_posting_id) do nothing
  returning id into v_referral_id;

  if v_referral_id is null then
    select id into v_referral_id
    from public.referrals
    where client_record_id = v_client_record_id
      and job_posting_id = p_job_posting_id;
  end if;
  return v_referral_id;
end;
$$;

comment on function public.request_referral_as_seeker(uuid) is
  '求職者が AI 推薦経由で「応募を依頼」する RPC。linked 関係を検証して referrals に行を作る。';

grant execute on function public.request_referral_as_seeker(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 自身が応募依頼済みの job_posting_id を一覧
-- ───────────────────────────────────────────────────────────────────
create or replace function public.list_seeker_requested_job_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select r.job_posting_id
  from public.referrals r
  join public.client_records cr on cr.id = r.client_record_id
  where cr.linked_user_id = auth.uid()
    and cr.link_status = 'linked'
$$;

grant execute on function public.list_seeker_requested_job_ids() to authenticated;
