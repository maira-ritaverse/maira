-- =====================================================================
-- 二段階解除 P6: revoke_deadline 超過 の revoke_requested を 自動 revoked へ
--
-- 現状 (P4):
--   求職者 が 解除 申請 (link_status = 'revoke_requested', revoke_deadline 打刻)
--   → エージェント が 「即時 承認」 ボタン で revoked + 'agency_approved' 確定
--   → エージェント が 何 も しない 場合、 deadline を 超過 して も revoke_requested
--     の まま 残り続け、 監査 / 集計 上 ノイズ に なる (開示 自体 は P1+P2 の
--     時刻 条件 で 既に 停止 済 だ が、 ステータス が 不整合)。
--
-- 本 RPC:
--   service_role 専用 (Vercel Cron 経由) で 1 日 1 回 sweep し、
--   revoke_deadline < now() の revoke_requested 行 を まとめて
--   revoked + revoke_confirmed_via = 'timeout' に 確定 する。
--
-- 安全性:
--   ・revoked_at = now() を 打刻 (= 確定 時刻 が 監査 ログ 代わり)
--   ・更新 件数 を 返り値 で 返し、 cron route は それ を レスポンス に 含めて
--     監視 可能 に する
--   ・linked / revoked / その他 は WHERE で 弾く ため 二重 確定 は 起きない
-- =====================================================================

create or replace function public.auto_finalize_expired_revokes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.client_records
       set link_status = 'revoked',
           revoked_at = now(),
           revoke_confirmed_via = 'timeout',
           updated_at = now()
     where link_status = 'revoke_requested'
       and revoke_deadline is not null
       and revoke_deadline < now()
    returning id
  )
  select count(*)::integer into v_count from updated;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.auto_finalize_expired_revokes() is
  '二段階解除 P6: revoke_deadline 超過 の revoke_requested を 自動的 に revoked + ''timeout'' に 確定 する 日次 cron 用 RPC。 戻り値 は 確定 件数。';

-- service_role からの 実行 を 明示 (authenticated には grant しない = ユーザー
-- が 直接 叩けない)
revoke all on function public.auto_finalize_expired_revokes() from public;
grant execute on function public.auto_finalize_expired_revokes() to service_role;
