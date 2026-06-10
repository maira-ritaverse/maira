-- ============================================
-- 新着・更新バッジ機能(案B)P2:
--   一括 RPC list_linked_clients_career_profile_updated_at
--
-- 背景:
--   クライアント一覧で「本人データ最終更新時刻 > 自分の last_viewed_at」を
--   判定するために、各クライアントの career_profiles.updated_at が必要。
--   resumes / cvs は Phase 6 の RLS(20260607000011)で linked または期限内
--   revoke_requested の自組織クライアントについて直 SELECT が通るが、
--   career_profiles は Phase 1(20260607000004)で SELECT RLS を撤去済みのため
--   直 SELECT できない。
--
--   既存 get_linked_client_encrypted_career_profile(20260607000011 で最新)は
--   単一 client_record_id を受け取って暗号文を返す形だが、
--   一覧用途では N+1 を避けるため uuid[] を受け取って (client_record_id, updated_at)
--   のテーブルを返す一括 RPC を別途新設する。
--
-- 設計:
--   - 認可は既存 RPC の Phase 6 ロジックを完全に踏襲:
--     呼び出しエージェントが自組織メンバー、かつ各クライアントが
--     「linked」または「revoke_requested AND revoke_deadline > now()」の範囲に限定。
--     条件外のクライアントは結果から除外する(エラーにせず単に黙って落とす:
--     一覧用途では一部だけ落ちる挙動が自然で、画面側でバッジ非表示になるだけ)。
--   - 戻り値は client_record_id と updated_at のみ。
--     🔴 暗号文(encrypted_data)は絶対に返さない。更新時刻だけが必要。
--   - SECURITY DEFINER + set search_path = public、stable。
--     既存 RPC と同じパターン。auth.uid() / current_user_organization_id() で完結。
--
-- 既存 RPC は無変更:
--   get_linked_client_encrypted_career_profile は引き続き単一取得・暗号文返しで
--   詳細画面から使われ続ける。本 RPC は一覧専用の薄い追加。
-- ============================================

create or replace function public.list_linked_clients_career_profile_updated_at(
  p_client_record_ids uuid[]
)
returns table (
  client_record_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller_user_id uuid;
  v_caller_org_id uuid;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 自組織判定は 1 回だけ行い、以降は WHERE で再利用。
  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null then
    -- 組織非所属のユーザーは結果無し(エラーにせず空配列を返す:UI 側でバッジ非表示)。
    return;
  end if;

  -- 渡された client_record_id のうち、認可を満たすもののみについて
  -- career_profiles.updated_at を返す。認可の中身は既存 RPC
  -- get_linked_client_encrypted_career_profile(Phase 6)と完全一致:
  --   - 自組織のクライアント記録であること
  --   - linked_user_id が確定していること
  --   - link_status が 'linked' か、期限内 'revoke_requested' であること
  --
  -- 期限超過した revoke_requested は now() 評価で自動的に除外され、撤回権の
  -- 安全弁が cron 不要で成立する(既存 RPC / RLS と同じ仕組み)。
  --
  -- 🔴 暗号文(encrypted_data)はこの関数から絶対に返さない。
  -- 取り出すのは career_profiles.updated_at のみ。
  return query
  select cr.id, cp.updated_at
  from public.client_records cr
  join public.career_profiles cp on cp.user_id = cr.linked_user_id
  where cr.id = any(p_client_record_ids)
    and cr.organization_id = v_caller_org_id
    and cr.linked_user_id is not null
    and (
      cr.link_status = 'linked'
      or (
        cr.link_status = 'revoke_requested'
        and cr.revoke_deadline is not null
        and cr.revoke_deadline > now()
      )
    );
end;
$$;

comment on function public.list_linked_clients_career_profile_updated_at(uuid[]) is
  '新着・更新バッジ用の一括 RPC。渡された client_record_id のうち、'
  'linked または期限内 revoke_requested の自組織クライアントについて '
  'career_profiles.updated_at のみを返す。'
  '認可は get_linked_client_encrypted_career_profile(Phase 6)と完全に揃える。'
  '🔴 暗号文(encrypted_data)は返さない(更新時刻のみ)。'
  'SECURITY DEFINER / stable。';
