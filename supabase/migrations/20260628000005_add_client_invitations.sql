-- ============================================
-- client_invitations:エージェント → 求職者 への 招待メール発行
--
-- 既存:
--   organization_invitations  ← エージェントメンバー(admin/advisor)招待
--   client_records.link_status='invited'  ← エージェント側で「招待中」と DB に記録するだけ
--
-- 課題:
--   求職者は自己 signup できない設計(/signup は invitationToken 必須)。
--   client_records 側にはトークンが無いため、メール送信もリンク生成もできない。
--   → 求職者用の招待テーブルを新規追加して 「トークン発行 → メール送信 → /signup 着地 →
--     accept → linked」 のフロー全体を成立させる。
--
-- 設計判断:
--   ・別テーブルにした(organization_invitations と混ぜない)
--     理由:対象が「組織メンバー」ではなく「特定の client_record と紐づく求職者」で
--           参照キーも遷移先(linked_user_id)も別。RLS / RPC を素直に書ける。
--   ・1 client_record につき pending は 1 つだけ(部分 UNIQUE index)
--     理由:再送時は古い pending を 'revoked' にしてから新規 insert する運用。
--           「同じ求職者にトークン違いで複数有効」になると UX も実装も複雑になる。
--   ・email は client_records.email のスナップショット(変更追従しない)
--     理由:招待後に client_records.email を書き換えても古い招待は元アドレスに送られた
--           履歴があるので、accept 時の検証も発行時のスナップショットで行う。
-- ============================================
create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  client_record_id uuid not null
    references public.client_records(id) on delete cascade,
  -- organization_id は冗長(client_records から辿れる)だが RLS と index で頻用する
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by_member_id uuid
    references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.client_invitations is
  'エージェント → 求職者 への 招待メール発行。token 経由で /signup に着地、'
  'メール認証後に accept_client_invitation で client_records と linked。';

create index if not exists idx_client_invitations_token
  on public.client_invitations(token);
create index if not exists idx_client_invitations_org
  on public.client_invitations(organization_id);
create index if not exists idx_client_invitations_client_record
  on public.client_invitations(client_record_id);
-- pending の email lookup(callback 側で「自分宛 pending を探す」用)
create index if not exists idx_client_invitations_pending_email
  on public.client_invitations(lower(email))
  where status = 'pending';

-- 1 client_record につき pending は 1 つだけ
create unique index if not exists ux_client_invitations_one_pending
  on public.client_invitations(client_record_id)
  where status = 'pending';

alter table public.client_invitations enable row level security;

-- SELECT: 同 org のメンバーが閲覧可(招待状況の UI 表示用)
-- 招待リンク経由の検証は service_role + token で行う(RLS バイパス)
create policy ci_select
  on public.client_invitations for select
  using (organization_id = public.current_user_organization_id());

-- INSERT / UPDATE / DELETE は SECURITY DEFINER RPC 経由のみ(直接の DML は禁止)
-- → 何のポリシーも作らないことで暗黙拒否。
--   service_role はバイパスするので Edge Functions / RPC からは書ける。


-- ============================================
-- 1. issue_client_invitation
--
-- 用途:エージェントが「連携を招待する」または「招待を再送する」を押した時。
-- 動作:
--   ・同 org メンバー判定
--   ・client_records.link_status を 'invited' に更新
--   ・古い pending を 'revoked' にして 新規 insert
--   ・再送クールダウン:直近 sent_at から 5 分以内 は 'resend_too_soon' で拒否
--
-- 入力:p_client_record_id, p_token, p_expires_at
-- 出力:client_invitations.id(invitation_id)
-- ============================================
create or replace function public.issue_client_invitation(
  p_client_record_id uuid,
  p_token text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
  v_caller_member_id uuid;
  v_client_org_id uuid;
  v_client_email text;
  v_link_status text;
  v_last_sent_at timestamptz;
  v_new_id uuid;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 対象 client_record をロック
  select organization_id, email, link_status
    into v_client_org_id, v_client_email, v_link_status
  from public.client_records
  where id = p_client_record_id
  for update;

  if v_client_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 同組織メンバー判定
  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null or v_caller_org_id <> v_client_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 既に linked / revoke_requested / revoked への遷移待ちは招待しない
  -- (unlinked / revoked / invited[=再送] のみ許可)
  if v_link_status not in ('unlinked', 'revoked', 'invited') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- 再送クールダウン:直近 sent_at から 5 分以内 は拒否(スパム対策)
  select max(sent_at) into v_last_sent_at
  from public.client_invitations
  where client_record_id = p_client_record_id;

  if v_last_sent_at is not null and (now() - v_last_sent_at) < interval '5 minutes' then
    raise exception 'resend_too_soon' using errcode = 'P0001';
  end if;

  -- 古い pending を revoke
  update public.client_invitations
  set status = 'revoked',
      revoked_at = now()
  where client_record_id = p_client_record_id
    and status = 'pending';

  -- 呼び出し元 member_id(audit 用)
  select id into v_caller_member_id
  from public.organization_members
  where user_id = v_caller_user_id
    and organization_id = v_caller_org_id
  limit 1;

  -- 新規 insert(part unique index で「pending は 1 つだけ」)
  insert into public.client_invitations (
    client_record_id, organization_id, email, token,
    expires_at, status, sent_at, created_by_member_id
  ) values (
    p_client_record_id, v_client_org_id, v_client_email, p_token,
    p_expires_at, 'pending', now(), v_caller_member_id
  )
  returning id into v_new_id;

  -- client_records 側の状態も更新(unlinked|revoked → invited)
  update public.client_records
  set link_status = 'invited',
      -- 過去の linked 痕跡は招待時点でクリア(再招待で古い linked_user_id を引きずらない)
      linked_user_id = null,
      linked_at = null,
      revoked_at = null,
      updated_at = now()
  where id = p_client_record_id;

  return v_new_id;
end;
$$;

comment on function public.issue_client_invitation(uuid, text, timestamptz) is
  '同 org メンバーが client_record に対して 招待トークンを発行する。'
  '古い pending は revoked にして新規 insert。直近 5 分以内の再送は拒否。';


-- ============================================
-- 2. accept_client_invitation
--
-- 用途:求職者が /signup で アカウント作成後、メール認証 callback で自動呼び出し。
-- 動作:
--   ・auth ユーザーのメールと client_invitations.email が一致するか確認
--   ・status='pending' / 期限内 のみ受諾可
--   ・client_records.link_status='linked' + linked_user_id セット
--   ・client_invitations.status='accepted'
--
-- 設計:トークンではなく caller の email で pending を引く
--   理由:callback 経路で token を保持する仕組みを増やしたくない。
--         signup 直後のユーザーには 1 件しか pending は無いはず(部分 UNIQUE index 保証)。
--
-- 入力:なし(auth.uid() / auth.email から自動引き)
-- 出力:linked された client_record_id(無ければ null)
-- ============================================
create or replace function public.accept_client_invitation()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_user_id uuid;
  v_caller_email text;
  v_invitation_id uuid;
  v_client_record_id uuid;
  v_expires_at timestamptz;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_caller_email := public.current_user_email();
  if v_caller_email is null then
    raise exception 'email_unavailable' using errcode = 'P0001';
  end if;

  -- 自分宛の pending を探す(lower(email) で一致)
  -- ux_client_invitations_one_pending により client_record ごとに 1 つだけだが、
  -- 同 email で複数 client_record にまたがる招待が来ている可能性は排除しないので
  -- 最初の有効な 1 件を採用する(複数あれば追加分は次回 callback で処理する想定)。
  select id, client_record_id, expires_at
    into v_invitation_id, v_client_record_id, v_expires_at
  from public.client_invitations
  where lower(email) = v_caller_email
    and status = 'pending'
  order by sent_at asc
  limit 1
  for update;

  if v_invitation_id is null then
    -- 招待が見つからない場合は黙って return(callback 経路で何もしない)
    return null;
  end if;

  if v_expires_at <= now() then
    update public.client_invitations
    set status = 'expired'
    where id = v_invitation_id;
    return null;
  end if;

  -- 招待を accepted に
  update public.client_invitations
  set status = 'accepted',
      accepted_at = now()
  where id = v_invitation_id;

  -- client_records を linked に
  update public.client_records
  set link_status = 'linked',
      linked_user_id = v_caller_user_id,
      linked_at = now(),
      revoked_at = null,
      updated_at = now()
  where id = v_client_record_id;

  return v_client_record_id;
end;
$$;

comment on function public.accept_client_invitation() is
  '求職者の auth セッションから pending 招待を探して accept し client_records を linked にする。'
  'callback 経路で 1 度呼ぶ前提。複数 pending があれば最古を 1 件処理する。';


-- ============================================
-- 3. cancel_client_invitation 既存関数を 拡張
--
-- 旧:client_records.link_status を unlinked に戻すだけ
-- 新:同時に client_invitations.status='pending' を 'revoked' に
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

  -- pending な招待を revoke(部分 UNIQUE index で最大 1 つ)
  update public.client_invitations
  set status = 'revoked',
      revoked_at = now()
  where client_record_id = p_client_record_id
    and status = 'pending';

  update public.client_records
  set link_status = 'unlinked',
      updated_at = now()
  where id = p_client_record_id;
end;
$$;
