-- =====================================================================
-- 同意ゲートで署名時に入力された「利用組織(乙)の所在地」を保存する
--
-- 背景:
--   NDA / 利用規約の同意ゲートは氏名(タイプ署名)のみを取得しており、署名する側の
--   利用組織の住所が署名済み PDF に反映されなかった。利用組織の所在地を入力させ、
--   署名済み PDF の「利用組織 住所 / 乙 所在地」に反映するため、organizations に列を追加。
--
--   NDA・利用規約は同じ組織が署名するため住所は 1 つ(組織単位・最新入力で上書き)。
--   書き込みは consent accept API が service_role で行う(管理者本人であることを検証済み)。
-- =====================================================================

alter table public.organizations
  add column if not exists signing_org_address text;

comment on column public.organizations.signing_org_address is
  '同意ゲートで署名時に入力された利用組織(乙)の所在地。署名済み NDA / 利用規約 PDF に反映。';
