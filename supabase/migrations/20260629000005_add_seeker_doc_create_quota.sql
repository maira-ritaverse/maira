-- =====================================================================
-- 求職者 履歴書 / 職務経歴書 作成数 制限 + ブーストチケット
--
-- 仕様:
--   ・無料:履歴書 5 件 / 月、 職務経歴書 5 件 / 月 (月次リセット)
--   ・ブーストチケット ¥2,000:両方 +10 件 / 月、3 ヶ月間 有効、 スタック可
--   ・複製は カウントしない (source_resume_id / source_cv_id が ある INSERT)
--   ・削除しても カウント は 減らない (ai_usage_events の 永久 行)
--
-- 設計:
--   ・既存 ai_usage_events を 流用 (kind に 新 4 種追加 → enum 不要、 text 列)
--   ・ブースト購入記録 は 専用テーブル seeker_doc_create_boosts
--   ・3 ヶ月有効 = effective_from (購入月 1 日 UTC) 〜 effective_until
--     (購入月 + 3 ヶ月 1 日 UTC、 排他的)
--   ・当月 のブースト件数 取得 RPC で boost 加算 件数 を 計算
-- =====================================================================

create table if not exists public.seeker_doc_create_boosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 購入した 月の 1 日 (UTC)
  effective_from timestamptz not null,
  -- 失効 月の 1 日 (UTC)、 排他的 (この 日 を 含む 月 は もう 無効)
  effective_until timestamptz not null,
  -- 1 枚あたり 加算する 件数 (将来 値を 変える 余地で 残す)
  multiplier_delta integer not null default 10,
  stripe_session_id text unique,
  purchased_at timestamptz not null default now(),
  refunded_at timestamptz,
  constraint effective_range_valid check (effective_until > effective_from)
);

create index if not exists seeker_doc_create_boosts_user_period_idx
  on public.seeker_doc_create_boosts (user_id, effective_from, effective_until);

comment on table public.seeker_doc_create_boosts is
  '求職者 履歴書 / 職務経歴書 作成 ブーストチケット (Stripe 単発 ¥2,000、3 ヶ月有効)。';

alter table public.seeker_doc_create_boosts enable row level security;

-- RLS: 本人 のみ 自分の 購入履歴 を SELECT 可、 INSERT / UPDATE は service_role のみ
create policy "seeker_doc_create_boosts_self_select"
  on public.seeker_doc_create_boosts
  for select
  using (auth.uid() = user_id);

-- service_role での INSERT / UPDATE は RLS バイパス で OK (Stripe Webhook 経由)。
-- 通常ユーザーから の 直接書込み は ポリシーなし で 拒否。

-- ---------------------------------------------------------------------
-- RPC: 当月 の アクティブ ブーストチケット 件数 を 取得
--
-- 「当月 = p_month_start (UTC月初)」を 引数 に 取り、 effective_from <= 当月
-- かつ 当月 < effective_until で refunded_at が null の レコード を 数える。
-- ---------------------------------------------------------------------
create or replace function public.get_seeker_doc_create_boost_count(
  p_month_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  select count(*)::integer into v_count
  from public.seeker_doc_create_boosts
  where user_id = auth.uid()
    and effective_from <= p_month_start
    and p_month_start < effective_until
    and refunded_at is null;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.get_seeker_doc_create_boost_count(timestamptz) is
  '呼出元 求職者の 当月 アクティブ ブーストチケット 件数 を 返す (ai-usage.ts 内部利用)。';

grant execute on function public.get_seeker_doc_create_boost_count(timestamptz) to authenticated;
