-- ============================================
-- 紹介ステータス遷移履歴(referral_status_history)
--
-- referrals.status の変更履歴を「いつ・何から何へ・誰が変えたか」
-- の形で残すための追記型テーブル。
--
-- 設計方針:
--   - 追記中心(INSERT / SELECT がメイン)。UPDATE/DELETE は最小限。
--   - 平文。エージェント企業の業務記録(企業所有データ)なので
--     client_interactions / agency_tasks と同じく平文で保存する。
--   - from_status / to_status は text(check 制約なし)。
--     referrals.status の値が将来「マスター参照」に切り替わっても
--     過去履歴の文字列がそのまま残せるよう、敢えて緩く持つ。
--     ラベル化は lib/referrals/types.ts の referralStatusConfig を再利用。
--   - changed_at と created_at は別物:
--       changed_at = 実際にステータスが変わった瞬間(過去日付で記録もあり得る)
--       created_at = この行を DB に挿入した時刻
--     client_interactions の occurred_at / created_at と同じ思想。
--   - changed_by_member_id は set null(担当者が抜けても履歴は残す)。
--   - 自動記録の仕組み(referrals.status の変更を拾うトリガー等)は
--     次のステップ2で追加する。本ファイルはテーブル + RLS のみ。
-- ============================================

create table if not exists public.referral_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- どの紹介の履歴か(紹介が消えれば履歴も無意味になるので cascade)
  referral_id uuid not null references public.referrals(id) on delete cascade,

  -- 遷移内容
  -- from_status は初回(planned 作成時)は NULL を許容
  from_status text,
  to_status text not null,

  -- 変更した担当者(メンバーが抜けても履歴は残したいので set null)
  changed_by_member_id uuid references public.organization_members(id) on delete set null,

  -- 実際に状態が遷移した日時(過去日付の遡及記録もあり得る)
  changed_at timestamptz not null default now(),

  -- 任意の備考(「最終面接NGで見送り」等の補足)
  memo text,

  -- この行を DB に挿入した時刻
  created_at timestamptz not null default now()
);

comment on table public.referral_status_history is '紹介ステータス遷移履歴(平文、追記中心)';
comment on column public.referral_status_history.from_status is '変更前の status。初回(planned 新規作成時等)は NULL 可';
comment on column public.referral_status_history.to_status is '変更後の status(必須)';
comment on column public.referral_status_history.changed_at is '実際に遷移した日時(挿入日時 created_at とは別)';

-- 紹介詳細画面で「履歴を新しい順」が主クエリ
create index if not exists idx_referral_status_history_referral
  on public.referral_status_history(referral_id);
create index if not exists idx_referral_status_history_changed
  on public.referral_status_history(changed_at desc);

-- 組織横断のスキャン(将来のレポート用)
create index if not exists idx_referral_status_history_org
  on public.referral_status_history(organization_id);

alter table public.referral_status_history enable row level security;

-- ============================================
-- RLS ポリシー
--
-- 20260531000002 で導入した SECURITY DEFINER ヘルパー経由で
-- organization_members の自己参照による無限再帰(42P17)を回避する。
-- client_records / referrals / client_interactions と完全に同じパターン。
--
-- 履歴は「追記して残す」性質なので、運用上のメインは SELECT / INSERT。
-- UPDATE は修正用途(備考の追記など)に同org全員へ許容。
-- DELETE は誤登録の取り消し用途で admin のみに限定。
-- ============================================

-- 閲覧:同org全員
create policy "Members can view referral_status_history in their organization"
  on public.referral_status_history for select
  using (organization_id = public.current_user_organization_id());

-- 追加:同org全員(自動記録・手動記録ともに同org内で行う前提)
create policy "Members can insert referral_status_history in their organization"
  on public.referral_status_history for insert
  with check (organization_id = public.current_user_organization_id());

-- 更新:同org全員(備考の修正等)
create policy "Members can update referral_status_history in their organization"
  on public.referral_status_history for update
  using (organization_id = public.current_user_organization_id());

-- 削除:管理者のみ(履歴の誤登録取り消し用途)
create policy "Admins can delete referral_status_history in their organization"
  on public.referral_status_history for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- ============================================
-- updated_at トリガーは付けない。
-- 履歴は「追記して残す」性質で、更新は備考の手当てが中心。
-- 直近の編集時刻が必要になったら別途追加する。
-- ============================================
