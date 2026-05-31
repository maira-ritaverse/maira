-- ============================================
-- 紹介(マッチング):クライアント × 求人
--
-- エージェント企業がクライアント(求職者)を求人に紹介し、
-- 進捗ステータスを管理するための多対多テーブル。
--   client_records (1) ─< referrals >─ (1) job_postings
--
-- 同じクライアントを同じ求人に二重登録しないように unique 制約。
-- 複数の求人への紹介(逆も)は可。
-- ============================================

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- 紐づけ
  -- client / job のどちらかが消えたら紹介自体も無意味になるので cascade
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,

  -- 紹介ステータス(固定6+1段階)
  -- 将来、企業ごとにステータスをカスタマイズできるよう enum ではなく
  -- text + check 制約にしている。ラベル・順序・色はコード側
  -- (lib/referrals/types.ts)の referralStatusConfig に集約する。
  -- DB のステータスマスター化に移行する際は、ここの check を外し
  -- 外部キー参照に置き換える想定。
  status text not null default 'planned'
    check (status in (
      'planned',      -- 推薦予定
      'recommended',  -- 推薦済
      'screening',    -- 書類選考
      'interview',    -- 面接
      'offer',        -- 内定
      'joined',       -- 入社
      'declined'      -- 見送り
    )),

  -- 推薦メモ(なぜこの人をこの求人に推薦するか)
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 同じクライアントを同じ求人に二重紹介しない
  unique (client_record_id, job_posting_id)
);

comment on table public.referrals is '紹介(マッチング):クライアントを求人に紹介し進捗を管理';
comment on column public.referrals.status is 'planned/recommended/screening/interview/offer/joined/declined(固定6段階、将来カスタマイズ予定)';

create index if not exists idx_referrals_org_id on public.referrals(organization_id);
create index if not exists idx_referrals_client on public.referrals(client_record_id);
create index if not exists idx_referrals_job on public.referrals(job_posting_id);
create index if not exists idx_referrals_status on public.referrals(status);

alter table public.referrals enable row level security;

-- ============================================
-- RLS ポリシー
--
-- 20260531000002 で導入した SECURITY DEFINER ヘルパー関数を使い、
-- organization_members 自己参照による無限再帰(42P17)を回避する。
--   - public.current_user_organization_id()    : 現ユーザーの所属企業ID
--   - public.current_user_organization_role()  : 現ユーザーのロール(admin/advisor)
-- client_records / job_postings と完全に同じパターン。
-- ============================================

-- 閲覧:同じ企業のメンバーは自社の紹介を見られる
create policy "Members can view referrals in their organization"
  on public.referrals for select
  using (organization_id = public.current_user_organization_id());

-- 追加:同じ企業のメンバーは自社の紹介を作成できる
create policy "Members can insert referrals in their organization"
  on public.referrals for insert
  with check (organization_id = public.current_user_organization_id());

-- 更新:同じ企業のメンバーは自社の紹介を更新できる
create policy "Members can update referrals in their organization"
  on public.referrals for update
  using (organization_id = public.current_user_organization_id());

-- 削除:管理者のみ、自社の紹介を削除できる
create policy "Admins can delete referrals in their organization"
  on public.referrals for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ============================================
-- updated_at トリガー
-- (set_updated_at 関数は 20260530000001 で作成済み)
-- ============================================
drop trigger if exists set_referrals_updated_at on public.referrals;
create trigger set_referrals_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();
