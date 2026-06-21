-- =====================================================================
-- list_birthday_clients_today_for_org: 今日 が 誕生日 の client_records
--
-- E-1 監査 で 発見 した 「誕生日 シナリオ で 全 顧客 を 取得 して JS で MM-DD
-- 判定」 を SQL 側 で 完結 さ せる RPC。 1000 件 組織 で 99% 以上 の 不要 行
-- 読み 込み が 削減 される。
--
-- 「今日」 は JST 基準 で 評価 (= ユーザー の 体感 日付 と 一致)。
--
-- 認可: SECURITY DEFINER。 Edge Function (ma-send-campaign) から service_role で
-- 呼ばれる 想定。 authenticated に も grant して おく (= 将来 アプリ UI から の
-- プレビュー で 必要 に なれば 同 org メンバー だけ が 自 org を 引ける ように
-- 別途 アプリ 側 で organization_id を 検証 する)。
-- =====================================================================

create or replace function public.list_birthday_clients_today_for_org(
  p_organization_id uuid
)
returns table (
  id uuid,
  name text,
  email text,
  assigned_member_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cr.id,
    cr.name,
    cr.email,
    cr.assigned_member_id
  from public.client_records cr
  where cr.organization_id = p_organization_id
    and cr.email_distribution_enabled = true
    and cr.birth_date is not null
    and extract(month from cr.birth_date)::int
        = extract(month from (now() at time zone 'Asia/Tokyo'))::int
    and extract(day from cr.birth_date)::int
        = extract(day from (now() at time zone 'Asia/Tokyo'))::int;
$$;

comment on function public.list_birthday_clients_today_for_org(uuid) is
  '指定 organization の 今日 誕生日 の クライアント を 返す (JST 基準)。 '
  'ma-send-campaign の 誕生日 シナリオ で 使用。 全件 取得 + JS フィルタ を 回避。';

grant execute on function public.list_birthday_clients_today_for_org(uuid)
  to service_role, authenticated;
