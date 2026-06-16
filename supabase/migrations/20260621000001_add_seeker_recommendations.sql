-- =====================================================================
-- 求職者本人の AI 求人推薦キャッシュ:seeker_job_recommendations
--
-- 目的:
--   ・/app/recommended-jobs で毎回 Claude を呼ぶのは遅い(10-20s)+ コスト
--   ・inputs_hash(career_profile + open jobs ids/updated_at)が変わらない限り
--     キャッシュを使い回す
--
-- セキュリティ:
--   ・本人のみ自分の行を見る/書ける(RLS)
--   ・rankings 自体は本人由来データ + 公開求人由来。それでも一貫性のため暗号化保存
--
-- 「興味あり」アクション(seeker_job_interests)も同じマイグレーションで追加:
--   ・求職者が AI 推薦の中で「この求人に興味あり」を 1 タップで表明
--   ・連携先エージェンシーがクライアント詳細で「興味あり」バッジを見て次のアクション
--   ・撤回も可能(DELETE)
-- =====================================================================

create table if not exists public.seeker_job_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  encrypted_rankings text not null,
  inputs_hash text not null,
  generated_at timestamptz not null default now()
);

create index if not exists sjr_generated_idx
  on public.seeker_job_recommendations (generated_at desc);

comment on table public.seeker_job_recommendations is
  '求職者本人の AI 求人推薦キャッシュ。inputs_hash で再計算判定。';

alter table public.seeker_job_recommendations enable row level security;

drop policy if exists sjr_self_rw on public.seeker_job_recommendations;
create policy sjr_self_rw
  on public.seeker_job_recommendations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────────
-- 「興味あり」アクション
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.seeker_job_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  -- どの client_record で linked されていたかを記録(将来の取消後にも履歴として残す)
  client_record_id uuid references public.client_records(id) on delete set null,
  -- 任意の一言(将来「興味の理由」を書けるようにする)
  encrypted_note text,
  created_at timestamptz not null default now(),
  unique (user_id, job_posting_id)
);

create index if not exists sji_job_idx on public.seeker_job_interests (job_posting_id);
create index if not exists sji_client_idx on public.seeker_job_interests (client_record_id);

comment on table public.seeker_job_interests is
  '求職者が AI 推薦の中で「興味あり」を表明した求人。連携エージェンシーに可視化される。';

alter table public.seeker_job_interests enable row level security;

-- 本人は自分の表明を select / insert / delete できる
drop policy if exists sji_self_select on public.seeker_job_interests;
create policy sji_self_select
  on public.seeker_job_interests
  for select
  using (auth.uid() = user_id);

drop policy if exists sji_self_insert on public.seeker_job_interests;
create policy sji_self_insert
  on public.seeker_job_interests
  for insert
  with check (auth.uid() = user_id);

drop policy if exists sji_self_delete on public.seeker_job_interests;
create policy sji_self_delete
  on public.seeker_job_interests
  for delete
  using (auth.uid() = user_id);

-- エージェントは「自社の job_posting に紐づく興味表明」を select できる
-- (組織所有の求人に対する興味であり、自社クライアントの行動として可視化したい)
drop policy if exists sji_org_select on public.seeker_job_interests;
create policy sji_org_select
  on public.seeker_job_interests
  for select
  using (
    exists (
      select 1 from public.job_postings jp
      where jp.id = job_posting_id
        and jp.organization_id = public.current_user_organization_id()
    )
  );
