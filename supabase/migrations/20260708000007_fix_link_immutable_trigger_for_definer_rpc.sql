-- =====================================================================
-- Fix: client_records.link_status 等 の immutable trigger が
--      SECURITY DEFINER RPC (issue_client_invitation / accept_client_invitation
--      / revoke 系) 経由 の 正当 な UPDATE も ブロック して しまう 問題
--
-- 症状: 「連携 を 招待 する」 ボタン を 押す と 「操作 に 失敗 しま した」
--       が 出る (RPC が link_status is immutable via direct update で 500)
--
-- 経緯:
--   Batch 1 の 監査 M8 で client_records の 連携 系 列
--   (linked_user_id / link_status / linked_at / revoked_at) を advisor の
--   直 UPDATE から 守る ため に trigger を 追加 した。
--   条件 は 「auth.role() = 'service_role'」 だけ を bypass 対象 と した が、
--   RPC (SECURITY DEFINER) 内 で 実行 される UPDATE では auth.role() は
--   呼び 出し 元 の 'authenticated' の まま で 通過 でき ず、 招待 経路 全体 が
--   壊れて いた。
--
-- 修正:
--   bypass 条件 を 「auth.role() = 'service_role' OR current_user が
--   スーパー ユーザー / セキュリティ 委譲 済 ロール の いずれ か」 に 変更。
--   SECURITY DEFINER 関数 の 中 で は current_user が 定義者 (postgres) に
--   切り 替わる ため、 これ で RPC 経由 の 正当 な UPDATE は 通過 する。
--   直 UPDATE (authenticated セッション で app が 直接 update を 打つ ケース)
--   は current_user = authenticated の まま な ので 引き続き ブロック される。
-- =====================================================================

create or replace function public.enforce_client_records_link_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role による 変更 (Webhook / cron / 管理 スクリプト) は 通す
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- SECURITY DEFINER 関数 経由 (issue_client_invitation / accept_client_invitation
  -- / revoke 系) の 更新 も 通す。 SECURITY DEFINER 内 では current_user が
  -- 定義者 の 特権 ロール に なる (Supabase では postgres / supabase_admin)。
  -- authenticated / anon セッション の 直 UPDATE では ここ に は 該当 しない。
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

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
  'client_records の 連携 系 列 を advisor 直 UPDATE から 保護。 M8 修正 + '
  'SECURITY DEFINER RPC 経由 の 正当 な 更新 も 通過 させる 拡張 (2026-07-08)。';
