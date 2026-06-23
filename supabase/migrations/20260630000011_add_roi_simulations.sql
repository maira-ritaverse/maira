-- LP の ROI 試算 ページ で 取得 する マーケティング リード を 保存 する テーブル
--
-- 用途:
--   ・公開 LP ( = 認証 不要 ) から の submit を 受け、 会社 情報 + ROI 入力 + 計算 結果 を 1 行 で 保存
--   ・運営 ( admin ) のみ が 閲覧 可能 ( マーケティング 用途 )
--   ・INSERT は service_role の API ルート 経由 ( /api/marketing/roi-simulation ) のみ

create table if not exists roi_simulations (
  id uuid primary key default gen_random_uuid(),

  -- 必須 の 会社 情報 ( = 必須 フィールド )
  company_name text not null check (char_length(company_name) between 1 and 200),
  contact_name text not null check (char_length(contact_name) between 1 and 120),
  email text not null check (char_length(email) between 5 and 320),

  -- 任意 の 会社 情報 ( = マーケティング 補足 )
  role text check (role is null or char_length(role) <= 80),
  phone text check (phone is null or char_length(phone) <= 40),
  industry text check (industry is null or char_length(industry) <= 80),

  -- ROI 計算 の 入力 値 ( snapshot )
  advisor_count integer not null check (advisor_count >= 0 and advisor_count <= 100000),
  monthly_clients integer not null check (monthly_clients >= 0 and monthly_clients <= 1000000),
  monthly_deals integer not null check (monthly_deals >= 0 and monthly_deals <= 1000000),
  avg_fee_man_yen integer not null check (avg_fee_man_yen >= 0 and avg_fee_man_yen <= 100000),
  doc_minutes_per_case integer not null check (doc_minutes_per_case >= 0 and doc_minutes_per_case <= 1440),
  monthly_lost_leads integer check (monthly_lost_leads is null or (monthly_lost_leads >= 0 and monthly_lost_leads <= 1000000)),
  advisor_hourly_yen integer check (advisor_hourly_yen is null or (advisor_hourly_yen >= 0 and advisor_hourly_yen <= 1000000)),

  -- 計算 結果 の snapshot ( 後 で 集計 / グラフ 化 に 利用 )
  calculated_yearly_total_yen bigint not null check (calculated_yearly_total_yen >= 0),
  calculated_yearly_doc_savings_yen bigint not null default 0,
  calculated_yearly_lead_recovery_yen bigint not null default 0,
  calculated_yearly_deal_uplift_yen bigint not null default 0,

  -- 簡易 メタ ( 同一 ユーザー の 連続 submit / 攻撃 検知 用 )
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 64),

  created_at timestamptz not null default now()
);

-- 検索 用 ( admin 一覧 の 並び順 )
create index if not exists roi_simulations_created_at_idx on roi_simulations (created_at desc);
create index if not exists roi_simulations_email_idx on roi_simulations (lower(email));

-- RLS: 公開 INSERT は API 経由 ( service_role ) のみ。 admin role 以外 SELECT 不可。
alter table roi_simulations enable row level security;

-- admin ロール のみ SELECT 可能。 admin の 識別 は profiles.is_maira_admin = true で 判定。
create policy "roi_simulations_select_admin"
  on roi_simulations for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.is_maira_admin is true
    )
  );

-- INSERT は service_role のみ ( anon / authenticated に は ポリシー を 作らない = デフォルト 拒否 )
-- service_role は RLS を バイパス する ため ポリシー 不要。

comment on table roi_simulations is 'LP の ROI 試算 フォーム の 送信 ログ。 公開 LP 経由 で service_role API が INSERT し、 admin のみ SELECT する。';
