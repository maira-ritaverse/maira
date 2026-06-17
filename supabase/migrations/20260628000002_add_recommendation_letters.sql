-- =====================================================================
-- 推薦文(recommendation_letters)
--
-- エージェントが求人企業に提出する正式な推薦文(推薦状)。
-- referrals(クライアント × 求人)1 件に対して複数バージョン(履歴)を持つ。
--
-- バージョン運用:
--   ・1 referral あたり version=1, 2, 3, ... と単調増加で履歴を残す。
--   ・最新版が「現在の推薦文」。確定(status=finalized)後は編集不可。
--   ・誤確定の修正は「新バージョン作成 → 編集 → 確定」で行う(過去版は残す)。
--
-- 暗号化:
--   ・本文 / 件名は候補者の経歴・志望理由を含む機密情報のため
--     lib/crypto/field-encryption.ts で AES-256-GCM 暗号化して保存。
--   ・保存形式は v{n}:base64url(iv ‖ ciphertext+authTag)。
--   ・テンプレ(prefix_body / suffix_body)は別テーブルで平文(機密でない定型句)。
--
-- セキュリティ:
--   ・referrals と同じ RLS パターン:組織メンバーは閲覧 / 追加 / 更新可、
--     削除は admin のみ(誤って履歴を消すのを防ぐ)。
-- =====================================================================

create table if not exists public.recommendation_letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- referral が消えたら推薦文も無意味になるので cascade
  referral_id uuid not null references public.referrals(id) on delete cascade,

  -- 履歴のバージョン番号(1, 2, 3, ...)。同じ referral 内で一意。
  -- アプリ側で max+1 を採番、unique 違反時はリトライ(同時 POST 競合対策)。
  version int not null check (version >= 1),

  -- 状態:draft = 編集可、finalized = 確定済(編集不可、削除のみ admin)
  status text not null default 'draft'
    check (status in ('draft', 'finalized')),

  -- 暗号化済本文(AES-256-GCM、最大 8000 字 × 暗号化 base64 のオーバーヘッド分余裕)
  encrypted_body text not null check (length(encrypted_body) <= 16000),
  -- 暗号化済件名(短文、見出し用)
  encrypted_headline text not null check (length(encrypted_headline) <= 1000),

  -- 適用したテンプレ(任意。テンプレが消されても推薦文は残す = set null)
  template_id uuid references public.recommendation_letter_templates(id) on delete set null,

  -- 作成者(メンバーが抜けた履歴では null になり得る)
  created_by_member_id uuid references public.organization_members(id) on delete set null,

  -- 確定日時(status=finalized になったとき同時にセット)
  finalized_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 同じ referral 内でバージョン番号は一意
  unique (referral_id, version)
);

comment on table public.recommendation_letters is
  '推薦文(求人企業提出用)。referral 単位 × バージョン履歴。本文 / 件名は AES-256-GCM 暗号化。';
comment on column public.recommendation_letters.encrypted_body is
  'AES-256-GCM(v{n}:base64url(iv ‖ ct+tag))。lib/crypto/field-encryption.ts で復号。';
comment on column public.recommendation_letters.status is
  'draft = 編集可 / finalized = 確定済(編集不可、削除のみ admin)';

-- 履歴表示で「新しい順」が頻出なので作成日 desc に index
create index if not exists recommendation_letters_referral_created_idx
  on public.recommendation_letters (referral_id, created_at desc);

create index if not exists recommendation_letters_org_idx
  on public.recommendation_letters (organization_id);

create index if not exists recommendation_letters_status_idx
  on public.recommendation_letters (status);

-- 更新日時の自動セット
drop trigger if exists set_recommendation_letters_updated_at
  on public.recommendation_letters;
create trigger set_recommendation_letters_updated_at
  before update on public.recommendation_letters
  for each row execute function public.set_updated_at();

-- ===========================
-- RLS:referrals と同パターン
-- ===========================
alter table public.recommendation_letters enable row level security;

-- SELECT:同組織メンバーは自社の推薦文を閲覧可
drop policy if exists "Members can view recommendation letters in their organization"
  on public.recommendation_letters;
create policy "Members can view recommendation letters in their organization"
  on public.recommendation_letters for select
  using (organization_id = public.current_user_organization_id());

-- INSERT:同組織メンバーは推薦文を作成可
drop policy if exists "Members can insert recommendation letters in their organization"
  on public.recommendation_letters;
create policy "Members can insert recommendation letters in their organization"
  on public.recommendation_letters for insert
  with check (organization_id = public.current_user_organization_id());

-- UPDATE:同組織メンバーは編集可(finalized 後はアプリ層で拒否)
drop policy if exists "Members can update recommendation letters in their organization"
  on public.recommendation_letters;
create policy "Members can update recommendation letters in their organization"
  on public.recommendation_letters for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

-- DELETE:admin のみ。履歴の改ざんを防ぐ。
drop policy if exists "Admins can delete recommendation letters in their organization"
  on public.recommendation_letters;
create policy "Admins can delete recommendation letters in their organization"
  on public.recommendation_letters for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- =====================================================================
-- ai_usage_events.kind に 'recommendation_letter_draft' を追加
--
-- AI で推薦文ドラフトを生成した利用量を可視化・集計するため。
-- 既存値(photo_enhance / job_recommendation_seeker / job_recommendation_agency)
-- への影響なし。
-- =====================================================================

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_kind_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_kind_check
  check (kind in (
    'photo_enhance',
    'job_recommendation_seeker',
    'job_recommendation_agency',
    'recommendation_letter_draft'
  ));
