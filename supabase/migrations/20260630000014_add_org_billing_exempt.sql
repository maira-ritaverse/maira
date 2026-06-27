-- 組織 単位 で 「課金 免除 ( = 課金 を 走ら せ ない )」 を 制御 する フラグ。
--
-- 用途:
--   ・運営 用 テスト アカウント や 試 用 提携 先 など、 課金 を 走ら せ たく ない
--     組織 を admin が 個別 に 指定 できる ように する
--   ・デフォルト は false ( = 基本 課金 ON が ベース )
--
-- 機能 制限 は かけ ない ( 免除 中 = 課金 中 と 同じ 扱い )。
-- 課金 ロジック ( Stripe 連携 後 ) で is_billing_exempt = true なら
-- 課金 処理 を スキップ する 分岐 を 入れる 想定。
--
-- 監査 観点 から 「いつ、 誰 が、 なぜ」 を 一緒 に 保存。

alter table public.organization_plans
  add column if not exists is_billing_exempt boolean not null default false,
  add column if not exists billing_exempt_reason text,
  add column if not exists billing_exempt_set_at timestamptz,
  add column if not exists billing_exempt_set_by_user_id uuid
    references public.profiles(id) on delete set null;

comment on column public.organization_plans.is_billing_exempt is
  '課金 免除 フラグ。 true なら Stripe 課金 を スキップ し 課金 中 相当 と して 扱う。';
comment on column public.organization_plans.billing_exempt_reason is
  '課金 免除 を 付与 した 理由 ( admin が 入力 )。';
comment on column public.organization_plans.billing_exempt_set_at is
  '課金 免除 を 最後 に トグル した タイムスタンプ。';
comment on column public.organization_plans.billing_exempt_set_by_user_id is
  '課金 免除 を 最後 に トグル した admin の profiles.id。';

-- 免除 中 を 素早く 一覧 する ため の 部分 インデックス
create index if not exists idx_org_plans_billing_exempt
  on public.organization_plans (organization_id)
  where is_billing_exempt = true;
