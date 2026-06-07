-- ============================================
-- 開示フロー Phase 2:client_records.link_status 遷移 RPC + invited 本人 SELECT RLS
--
-- 背景:
--   Phase 1 で career_profile の RLS 全体開放を撤去し、開示フローの土台を作る
--   方針に転換した。本 Phase ではエージェント↔求職者の連携(link_status)を
--   「招待 → 承認/拒否」「連携 → 解除」で正しく遷移させる土台を作る。UI(Phase 3)・
--   書類閲覧 RLS(Phase 4)・限定フィールド開示(Phase 5)は後続。
--
-- 設計方針(accept_invitation / issue_invitation の既存パターン踏襲):
--   - 全 RPC は SECURITY DEFINER / set search_path = public で固定。
--   - 内部で auth.uid() / FOR UPDATE ロック / 状態検証 / メール一致検証を厳密に行う。
--   - 状態遷移は RLS の UPDATE ポリシーに任せず、RPC 内で「許可された遷移のみ」を
--     明示的に通すゲートにする(RLS だけだと「invited → linked かつメール一致」の
--     ような複合条件を表現しきれない)。
--   - メール正規化は lower(trim(...))。issue_invitation と同パターン。
--   - エラーコードは accept_invitation / issue_invitation と同じ体系:
--       unauthenticated  (42501)
--       forbidden        (42501)
--       not_found        (P0002)
--       invalid_state    (P0001) ※許可されていない遷移
--       email_mismatch   (P0001)
--
-- 許可する遷移のみ(他は invalid_state で弾く):
--   エージェント側(同組織メンバーのみ):
--     - invite_client_record       unlinked|revoked → invited
--     - cancel_client_invitation   invited         → unlinked
--   求職者側(メール一致 or linked_user_id 一致が必須):
--     - accept_client_link         invited         → linked
--     - reject_client_link         invited         → unlinked
--     - revoke_client_link         linked          → revoked
-- ============================================

-- ============================================
-- 0. 認証ユーザーの正規化済みメール取得ヘルパー
--
-- なぜ SECURITY DEFINER:
--   auth.users への参照は通常の authenticated ロールでは不可。
--   関数所有者(postgres)権限で実行することで auth.users.email を読めるが、
--   関数内では「auth.uid() に一致する自分の行」しか取り出さないため、
--   呼び出し元が他人のメールを取れることはない。
--
-- なぜ stable:
--   同一クエリ内で auth.uid() の値は不変、auth.users.email も実質的に不変なので
--   stable とすることでプランナーが結果をキャッシュでき RLS でも性能が出る。
--
-- 用途:
--   - RLS ポリシーから直接呼べる(invited 本人 SELECT で利用)
--   - RPC 内のメール一致検証で利用
-- ============================================
create or replace function public.current_user_email()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select lower(trim(email))
  from auth.users
  where id = auth.uid()
  limit 1;
$$;

comment on function public.current_user_email() is
  '認証ユーザーの正規化済みメール(lower(trim))を返す。auth.users 参照のため SECURITY DEFINER。'
  '内部で auth.uid() に紐づく 1 行のみを引くので他人のメールは取れない。RLS から呼べる。';

-- ============================================
-- 1. invite_client_record(エージェント側:招待を出す)
--
-- 遷移:unlinked|revoked → invited
-- 認可:呼び出し元が当該 client_records.organization_id のメンバーであること
-- メモ:linked_user_id はこの時点では確定させない(承認時にメール一致で確定)。
--       linked_at / revoked_at は次の linked / revoked 遷移時に上書きされる。
-- ============================================
create or replace function public.invite_client_record(
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

  -- 対象行をロック(競合する別 RPC の同時実行を直列化)
  select organization_id, link_status
    into v_client_org_id, v_link_status
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_client_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 同組織メンバー判定(current_user_organization_id は SECURITY DEFINER stable)
  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null or v_caller_org_id <> v_client_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_link_status not in ('unlinked', 'revoked') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.client_records
  set link_status = 'invited',
      -- 招待時点で過去の linked 痕跡があれば一旦クリアする
      -- (revoked から再招待するときに古い linked_user_id を引きずらない)
      linked_user_id = null,
      linked_at = null,
      revoked_at = null,
      updated_at = now()
  where id = p_client_record_id;
end;
$$;

comment on function public.invite_client_record(uuid) is
  '同組織メンバーが unlinked|revoked のクライアントを invited に遷移させる。'
  'linked_user_id はここでは確定させず、accept_client_link でメール一致確認後に確定。';

-- ============================================
-- 2. cancel_client_invitation(エージェント側:招待取り消し)
--
-- 遷移:invited → unlinked
-- 認可:呼び出し元が当該 client_records.organization_id のメンバーであること
-- ============================================
create or replace function public.cancel_client_invitation(
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

  select organization_id, link_status
    into v_client_org_id, v_link_status
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_client_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null or v_caller_org_id <> v_client_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_link_status <> 'invited' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  update public.client_records
  set link_status = 'unlinked',
      updated_at = now()
  where id = p_client_record_id;
end;
$$;

comment on function public.cancel_client_invitation(uuid) is
  '同組織メンバーが invited 状態のクライアント招待を取り消す(unlinked に戻す)。';

-- ============================================
-- 3. accept_client_link(求職者側:招待を承認して連携)
--
-- 遷移:invited → linked
-- 認可:client_records.email と auth ユーザーの email が一致(case-insensitive, trim)
-- 確定:linked_user_id = auth.uid(), linked_at = now()
-- ============================================
create or replace function public.accept_client_link(
  p_client_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_email text;
  v_client_email text;
  v_link_status text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select email, link_status
    into v_client_email, v_link_status
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_client_email is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_link_status <> 'invited' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- メール一致(正規化:lower + trim、accept_invitation と同パターン)
  v_caller_email := public.current_user_email();
  if v_caller_email is null
     or v_caller_email <> lower(trim(v_client_email)) then
    raise exception 'email_mismatch' using errcode = 'P0001';
  end if;

  update public.client_records
  set link_status = 'linked',
      linked_user_id = v_caller_user_id,
      linked_at = now(),
      revoked_at = null,
      updated_at = now()
  where id = p_client_record_id;
end;
$$;

comment on function public.accept_client_link(uuid) is
  '求職者が invited 状態のクライアント招待を承認し linked に遷移。'
  'client_records.email と auth.users.email の lower(trim) 比較で本人確認。'
  'linked_user_id は承認時に auth.uid() で確定する。';

-- ============================================
-- 4. reject_client_link(求職者側:招待を拒否)
--
-- 遷移:invited → unlinked
-- 認可:メール一致(他人が他人宛て招待を勝手に破棄できないように)
-- ============================================
create or replace function public.reject_client_link(
  p_client_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_email text;
  v_client_email text;
  v_link_status text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select email, link_status
    into v_client_email, v_link_status
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_client_email is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_link_status <> 'invited' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  v_caller_email := public.current_user_email();
  if v_caller_email is null
     or v_caller_email <> lower(trim(v_client_email)) then
    raise exception 'email_mismatch' using errcode = 'P0001';
  end if;

  update public.client_records
  set link_status = 'unlinked',
      updated_at = now()
  where id = p_client_record_id;
end;
$$;

comment on function public.reject_client_link(uuid) is
  '求職者が invited 状態のクライアント招待を拒否し unlinked に戻す。メール一致必須。';

-- ============================================
-- 5. revoke_client_link(求職者側:連携解除)
--
-- 遷移:linked → revoked
-- 認可:呼び出し元 = client_records.linked_user_id(本人のみ)
--       メール一致では不十分(linked 後にメールアドレスが auth 側で変わる
--       可能性があるため、確定済みの linked_user_id で判定する)
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
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select linked_user_id, link_status
    into v_linked_user_id, v_link_status
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_link_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_link_status <> 'linked' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  if v_linked_user_id is null or v_linked_user_id <> v_caller_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.client_records
  set link_status = 'revoked',
      revoked_at = now(),
      updated_at = now()
  where id = p_client_record_id;
end;
$$;

comment on function public.revoke_client_link(uuid) is
  '本人(linked_user_id = auth.uid())が linked 状態のクライアントを revoked に遷移。'
  'メールではなく確定済み linked_user_id で本人確認(linked 後のメール変更に耐える)。';

-- ============================================
-- 6. invited 本人 SELECT RLS
--
-- 現状の client_records 本人 SELECT ポリシーは link_status='linked' 限定で、
-- invited 状態の招待行は本人にも見えない。承認 UI(Phase 3)で「自分宛て招待
-- 一覧」を作るために、メール一致する invited 行を本人が SELECT できる
-- ポリシーを追加する。
--
-- 見せる列:client_records 全列。エージェントが入力した自分宛て情報(name /
-- email / phone / notes / status / 担当者 等)を本人が見る形になる。これは
-- 「自分に関する招待情報を本人が見る」用途で方針上問題ないが、notes には
-- エージェントの内部メモが含まれうるため、Phase 3 の UI で表示する列は絞る
-- 運用(RLS で全列は許すが UI で見せない)。
--
-- linked 本人 SELECT は既存ポリシー(linked_user_id = auth.uid())をそのまま残す。
-- ============================================
create policy "Invited seeker can view their own client record by email"
  on public.client_records for select
  using (
    link_status = 'invited'
    and lower(trim(email)) = public.current_user_email()
  );
