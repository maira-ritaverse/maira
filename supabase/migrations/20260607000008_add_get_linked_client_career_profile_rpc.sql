-- ============================================
-- 開示フロー Phase 5:エージェント向け career_profile 暗号文取り出し RPC
--
-- 背景:
--   Phase 1 で career_profile の閲覧 RLS を撤去したため、エージェントセッションでは
--   career_profiles テーブルを直接 select できない。Phase 5 では「希望条件 + 現職/
--   経験年数/業界」だけを限定開示する経路が必要なので、認可と暗号文取り出しを DB に
--   閉じ込めた SECURITY DEFINER RPC を新設する。
--
-- 設計:
--   - 認可は DB 側で完結する:呼び出しエージェントが当該 client_records の
--     organization のメンバーであり、かつ link_status='linked' であることを検証。
--     満たさなければ 'forbidden' / 'not_found' を raise。
--   - 戻り値は encrypted_data(暗号文 text)のみ。復号は Next.js 側で
--     decryptField を経由して行う。Web Crypto API(crypto.subtle)は DB(plpgsql)で
--     動かないため境界はここに引かざるを得ない。
--   - 限定フィールド抽出(wants / user_facts の一部のみ)は Next.js 側の
--     extractDisclosableProfile(純粋関数)で行う。RPC は内面を含めて返すが、
--     最終的に UI 層へ渡る型は DisclosableProfile に縮約され、内面はそこで落ちる。
--     型レベルで漏れを止める設計は Phase 5 報告で明示する。
--
-- セキュリティ:
--   - SECURITY DEFINER + set search_path = public、既存パターン踏襲。
--   - 認可検証順序:auth.uid() → client_records 行(FOR SHARE で安定取得)→
--     organization 一致 → linked かつ linked_user_id が non-null → career_profiles
--     行の encrypted_data を返す。
--   - career_profiles 行が無い(=本人が未作成)場合は null を返す(エラーではない)。
--     呼び出し側 UI で「希望条件は未登録」のフォールバック表示に倒す。
--   - 暗号文は仕様上「v{n}:base64url」形式で、復号鍵が無ければ平文に戻せない。
--     ただし「漏出すれば運営者が復号できる暗号文を渡すこと」が方針上問題にならない
--     かは、開示同意済み(linked)のクライアントに限定することで担保している。
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
  v_encrypted text;
begin
  v_caller_user_id := auth.uid();
  if v_caller_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- 対象 client_records の最小限の認可属性を取得。state を後で変更する処理は
  -- ないので FOR UPDATE ではなく FOR SHARE で十分。
  select organization_id, link_status, linked_user_id
    into v_client_org_id, v_link_status, v_linked_user_id
  from public.client_records
  where id = p_client_record_id
  for share;

  if v_client_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- 呼び出しエージェントが当該クライアントの自組織メンバーであること
  v_caller_org_id := public.current_user_organization_id();
  if v_caller_org_id is null or v_caller_org_id <> v_client_org_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- linked かつ linked_user_id が確定していること
  -- (invited / unlinked / revoked、または linked だが uid 不明はすべて拒否)
  if v_link_status <> 'linked' or v_linked_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 暗号文を取得。career_profiles が未作成のユーザーには行が無く、null を返す。
  -- Phase 1 でエージェント向け閲覧 RLS は撤去されているが、本関数は
  -- SECURITY DEFINER で関数所有者(postgres)権限で実行されるため RLS をバイパスして
  -- 読める。認可は上記の client_records 検証で完結している。
  select encrypted_data into v_encrypted
  from public.career_profiles
  where user_id = v_linked_user_id;

  return v_encrypted;
end;
$$;

comment on function public.get_linked_client_encrypted_career_profile(uuid) is
  '開示フロー Phase 5。エージェントが linked 自組織クライアントの career_profile '
  '暗号文(encrypted_data)を取得する。SECURITY DEFINER で認可(linked かつ自組織)を '
  '検証し、復号は Next.js 側 decryptField で行う。career_profile 未作成なら null を返す。'
  '希望条件 + 現職/経験年数/業界 のみを抽出するのは呼び出し側の責務(extractDisclosableProfile)。';
