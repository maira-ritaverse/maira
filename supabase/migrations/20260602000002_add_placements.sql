-- ============================================
-- 成約管理(placements)
--
-- 1つの紹介(referral)に対して、複数イベント(成約 / 入金 /
-- 返金 / 追加報酬)を時系列で積み上げて記録する。
--
-- 設計の意図:
--   - referrals(紹介)に複数行の placements 行がぶら下がる構造。
--     UNIQUE 制約は付けず、同じ referral_id で複数イベントを許容する。
--   - event_type でイベント種別を区別。
--     純売上 = placement + additional - refund(集計はアプリ層)。
--   - amount は各イベントの金額(円)。
--     placement イベント時に「想定年収 × 手数料率」で計算するケースは
--     expected_salary / commission_rate を埋める。直接入力の場合は
--     これらを NULL のままにし amount を直接入れる。
--   - 平文。既存 client_interactions / agency_tasks と同じ
--     「企業所有データ」扱いで、ユーザー資産(暗号化対象)とは別物。
--   - RLS は client_records パターン(SECURITY DEFINER ヘルパー経由)で
--     無限再帰を回避する。
-- ============================================

create table if not exists public.placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- 紐づけ
  -- referral が消えたら成約レコードも無意味になるので cascade
  referral_id uuid not null references public.referrals(id) on delete cascade,

  -- イベント種別
  -- placement   : 成約(売上計上)
  -- payment     : 入金
  -- refund      : 返金
  -- additional  : 追加報酬
  -- enum でなく text + check にしているのは referrals.status と同じ理由
  -- (将来、企業ごとカスタマイズに移行しやすくするため)。
  event_type text not null
    check (event_type in ('placement', 'payment', 'refund', 'additional')),

  -- 金額関連(すべて円)
  -- amount: このイベントの金額(売上/入金/返金/追加)
  amount integer,

  -- placement イベントで「計算根拠」を残す用途。直接入力なら NULL。
  -- expected_salary は万円単位(例: 600 = 600万円)
  expected_salary integer,
  -- commission_rate は % 表記(例: 35.00 = 35%)
  commission_rate numeric(5, 2),

  -- イベント発生日(入社日 / 入金日 / 返金日 など)
  -- 過去日を後から登録するケースも想定するので date 型
  event_date date not null,

  -- payment_status は基本 payment イベントで使う。
  -- placement イベント単独でもステータス追跡したい場合に備えて NULL 許容。
  -- pending  : 入金待ち
  -- partial  : 一部入金
  -- paid     : 入金済
  -- refunded : 返金済
  -- adjusted : 調整済(減額・相殺など)
  payment_status text
    check (payment_status in ('pending', 'partial', 'paid', 'refunded', 'adjusted')),

  -- 補足
  -- notes : 一般的な備考
  -- reason: 返金理由・追加報酬の理由など、後から監査する用
  notes text,
  reason text,

  -- 記録者(担当アドバイザー)
  -- メンバーが抜けても履歴は残したいので set null
  created_by_member_id uuid references public.organization_members(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.placements is '成約管理。1 referral に対して複数イベント(成約/入金/返金/追加)を時系列で積む';
comment on column public.placements.event_type is 'placement/payment/refund/additional。純売上は placement + additional - refund で集計';
comment on column public.placements.amount is 'このイベントの金額(円)。placement なら売上、payment なら入金額など';
comment on column public.placements.expected_salary is '想定年収(万円)。amount を「年収 × 手数料率」で算出する場合のみ埋める';
comment on column public.placements.commission_rate is '手数料率(%、例: 35.00)。amount を計算する場合のみ埋める';
comment on column public.placements.payment_status is 'pending/partial/paid/refunded/adjusted。支払いの確定は API 層で admin 限定を強制する想定';

-- referral 単位でイベント一覧を時系列表示するクエリが主
create index if not exists idx_placements_referral
  on public.placements(referral_id);

-- 企業全体の集計・ダッシュボード用
create index if not exists idx_placements_org
  on public.placements(organization_id);

-- 月次集計や時系列レポート用(新しい順)
create index if not exists idx_placements_event_date
  on public.placements(event_date desc);

alter table public.placements enable row level security;

-- ============================================
-- RLS ポリシー
--
-- client_records / referrals / agency_tasks と同じく、SECURITY DEFINER
-- ヘルパー関数経由で再帰を回避する。
--   - public.current_user_organization_id()
--   - public.current_user_organization_role()
--
-- ⚠️ 「支払い確定(payment_status を paid にする)を admin 限定」のような
-- 列レベルの権限制御は RLS では難しいので、API 層で強制する想定。
-- ここではテーブルとRLSの基本のみ。
-- ============================================

create policy "Members can view placements in their organization"
  on public.placements for select
  using (organization_id = public.current_user_organization_id());

create policy "Members can insert placements in their organization"
  on public.placements for insert
  with check (organization_id = public.current_user_organization_id());

create policy "Members can update placements in their organization"
  on public.placements for update
  using (organization_id = public.current_user_organization_id());

create policy "Admins can delete placements in their organization"
  on public.placements for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ============================================
-- updated_at トリガー
-- (set_updated_at 関数は 20260530000001 で作成済み)
-- ============================================
drop trigger if exists set_placements_updated_at on public.placements;
create trigger set_placements_updated_at
  before update on public.placements
  for each row execute function public.set_updated_at();
