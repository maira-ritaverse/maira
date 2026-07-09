-- =====================================================================
-- organization_teams の color CHECK 制約 + name の case-insensitive/trim unique
--
-- 背景1 (color):
--   zod スキーマは #RRGGBB を検証しているが、 service_role 経由の直接 INSERT や
--   将来別経路が生えた場合に不正な色文字列が入るリスクがある。 DB 側でも defense-
--   in-depth で担保する。 既存データは全て zod 経由なので正規化のみで済むはず。
--
-- 背景2 (name unique):
--   現在の unique (organization_id, name) は case-sensitive。 「東京」 と 「東京 」
--   (末尾空白)、 「Sales」 と 「sales」 が 別 team として作れてしまい、 UI 上の
--   混乱を招く。 呼び出し側では nullif(trim(...)) している が、 過去に空白付きで
--   保存された行がある可能性を考慮して migration 内で正規化する。
--
-- 事前チェック:
--   実行前に dev で以下を確認 (重複検出):
--     select organization_id, lower(trim(name)), count(*)
--       from public.organization_teams
--      group by organization_id, lower(trim(name))
--     having count(*) > 1;
--   移行対象の team 数が少ないため実データでの重複は想定していないが、 万一に
--   備えて DO ブロックで 重複を検出した場合は raise exception で abort する。
-- =====================================================================

-- ========== 1. 既存値の正規化 (color 小文字化 + name の trim) ==========
update public.organization_teams
   set color = lower(color)
 where color is not null
   and color <> lower(color);

update public.organization_teams
   set name = trim(name)
 where name <> trim(name);

-- ========== 2. 重複防止 の 事前チェック ==========
do $$
declare
  v_dup_count int;
begin
  select count(*) into v_dup_count
    from (
      select organization_id, lower(name) as key
      from public.organization_teams
      group by organization_id, lower(name)
      having count(*) > 1
    ) t;
  if v_dup_count > 0 then
    raise exception 'organization_teams: case-insensitive name の 重複 が % 件あります。 事前解消してください。', v_dup_count;
  end if;
end;
$$;

-- ========== 3. color CHECK 制約 ==========
alter table public.organization_teams
  drop constraint if exists organization_teams_color_format_check;
alter table public.organization_teams
  add constraint organization_teams_color_format_check
  check (color is null or color ~ '^#[0-9a-f]{6}$');

-- ========== 4. name unique を case-insensitive に置き換え ==========
alter table public.organization_teams
  drop constraint if exists organization_teams_organization_id_name_key;

-- 式インデックスは constraint ではなく unique index として作成する必要がある。
drop index if exists ux_organization_teams_org_lower_name;
create unique index ux_organization_teams_org_lower_name
  on public.organization_teams (organization_id, lower(name));

comment on index public.ux_organization_teams_org_lower_name is
  'organization 内 で name の 大小文字を無視した unique を担保 (2026-07-09)。';
