-- =====================================================================
-- get_client_distribution_stats: クライアント 分布 を SQL 側 で 集計
--
-- 旧 実装 (lib/clients/queries.ts:getClientDistributionStats) は 全 行 取得 +
-- JS で 集計 して おり、 1000 件 組織 で 1000 行 を 毎 リクエスト 読み 込み
-- (= /agency/clients ページ 表示 の たび)。 SQL 側 で GROUP BY 集計 する こと
-- で 戻り 値 = 分類 数 (= 通常 10 件 程度) に 圧縮。
--
-- 認可: SECURITY DEFINER。 認可 は アプリ 層 で 確認 する 前提 だ が、
-- RPC 内 で 「呼び出し 元 が 自 org メンバー」 を 検証 し 他組織 集計 を 防ぐ。
-- =====================================================================

create or replace function public.get_client_distribution_stats(
  p_organization_id uuid
)
returns table (
  bucket_kind text,        -- 'close_reason' or 'entry_site' or 'total'
  bucket_value text,       -- 値 (close_reason の キー、 entry_site の キー、 'total')
  cnt bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  -- 呼び出し 元 が 自 org メンバー で ない 場合 は 0 件
  if p_organization_id is null
     or p_organization_id <> public.current_user_organization_id() then
    return;
  end if;

  return query
  -- close_reason 別 件数 (null 含む = 「未分類」 を 集計 する ため key を coalesce)
  select 'close_reason'::text, coalesce(close_reason, '__null__')::text, count(*)::bigint
  from public.client_records
  where organization_id = p_organization_id
  group by close_reason

  union all

  -- entry_site 別 件数
  select 'entry_site'::text, coalesce(entry_site, '__null__')::text, count(*)::bigint
  from public.client_records
  where organization_id = p_organization_id
  group by entry_site

  union all

  -- 合計
  select 'total'::text, 'total'::text, count(*)::bigint
  from public.client_records
  where organization_id = p_organization_id;
end;
$$;

comment on function public.get_client_distribution_stats(uuid) is
  'クライアント 分布 集計 (close_reason / entry_site / total)。 SQL 側 で GROUP BY 集計 し、 全 行 を JS に 読み 込ま ない。';

grant execute on function public.get_client_distribution_stats(uuid) to authenticated;
