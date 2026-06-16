-- =====================================================================
-- エージェント → 求職者 書類提出ドラフト(document_drafts_from_agency)
--
-- 目的:
--   ・エージェントが求職者向けに履歴書 / 職務経歴書の下書きを作成し、
--     求職者に「提出」する経路を提供
--   ・求職者は内容をプレビューしてから「自分の resumes / cvs に取り込む」かを判断
--   ・既存の resumes / cvs テーブルは本人所有(seeker)で書き換えしないため、
--     新規テーブルで「draft」を別管理する
--
-- セキュリティ:
--   ・encrypted_payload に AES-256-GCM 暗号化済 JSON を格納
--   ・本人(seeker)+ 作成者(agent)+ 同組織メンバーが SELECT 可
--   ・INSERT は同組織メンバー(linked client_record に対してのみ)
--   ・UPDATE は本人(accept / reject)+ 作成者(rescind)
--   ・DELETE は本人のみ
--
-- 求人ごとのカスタマイズ(application_id)は次マイグレーションで取り扱う:
--   本マイグレーションは「書類本体の提出 / 受領」だけを扱う最小スコープ。
-- =====================================================================

create table if not exists public.document_drafts_from_agency (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 提出元エージェント(organization_member の user_id)
  created_by_user_id uuid not null references auth.users(id) on delete set null,
  -- 紐づくクライアント(求職者の client_record)
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  -- 種別:履歴書 or 職務経歴書
  document_type text not null check (document_type in ('resume', 'cv')),
  -- タイトル(求職者一覧表示用、機密性低)
  title text not null,
  -- 暗号化された JSON 本体(v{n}:base64url 形式)
  -- スキーマは resumes / cvs と同じ構造(motivation_note / self_pr / 履歴 等)
  encrypted_payload text not null,
  -- 状態:draft(編集中、未提出)/ submitted(求職者に渡し中)/ accepted(求職者が取込済)
  --       / rejected(求職者が却下)/ rescinded(エージェントが取消)
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'accepted', 'rejected', 'rescinded')),
  -- 求職者が取込んだとき:取込先 resumes.id / cvs.id を記録(履歴トレース用)
  accepted_into_id uuid,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rescinded_at timestamptz,
  -- 任意のメッセージ(エージェント → 求職者の一言、暗号化はしない)
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ddfa_client_idx
  on public.document_drafts_from_agency (client_record_id);
create index if not exists ddfa_org_idx
  on public.document_drafts_from_agency (organization_id);
create index if not exists ddfa_status_idx
  on public.document_drafts_from_agency (status);

comment on table public.document_drafts_from_agency is
  'エージェントが求職者向けに作成した履歴書/職務経歴書ドラフト。本人が accept で resumes/cvs に取り込む。';

-- ───────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────
alter table public.document_drafts_from_agency enable row level security;

-- SELECT:
--   - 同組織メンバー(自社作成 + 自社所有クライアント宛 = organization_id 一致)
--   - 求職者本人(client_records.linked_user_id = auth.uid() の linked 行に紐づくもの)
drop policy if exists ddfa_org_select on public.document_drafts_from_agency;
create policy ddfa_org_select
  on public.document_drafts_from_agency
  for select
  using (organization_id = public.current_user_organization_id());

drop policy if exists ddfa_seeker_select on public.document_drafts_from_agency;
create policy ddfa_seeker_select
  on public.document_drafts_from_agency
  for select
  using (
    exists (
      select 1 from public.client_records cr
      where cr.id = client_record_id
        and cr.linked_user_id = auth.uid()
        and cr.link_status = 'linked'
    )
  );

-- INSERT:
--   - 同組織メンバーのみ
--   - client_record_id がその組織所属 + link_status='linked'(本人が受け取り可能な状態)に限定
drop policy if exists ddfa_org_insert on public.document_drafts_from_agency;
create policy ddfa_org_insert
  on public.document_drafts_from_agency
  for insert
  with check (
    organization_id = public.current_user_organization_id()
    and exists (
      select 1 from public.client_records cr
      where cr.id = client_record_id
        and cr.organization_id = public.current_user_organization_id()
        and cr.link_status = 'linked'
    )
  );

-- UPDATE:
--   - 同組織メンバー(rescind / draft 編集)
--   - 求職者本人(accept / reject) ※status 遷移は API 側でも検証
drop policy if exists ddfa_org_update on public.document_drafts_from_agency;
create policy ddfa_org_update
  on public.document_drafts_from_agency
  for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

drop policy if exists ddfa_seeker_update on public.document_drafts_from_agency;
create policy ddfa_seeker_update
  on public.document_drafts_from_agency
  for update
  using (
    exists (
      select 1 from public.client_records cr
      where cr.id = client_record_id
        and cr.linked_user_id = auth.uid()
        and cr.link_status = 'linked'
    )
  );

-- DELETE:本人のみ(自分宛の不要な draft を削除できる権利)
drop policy if exists ddfa_seeker_delete on public.document_drafts_from_agency;
create policy ddfa_seeker_delete
  on public.document_drafts_from_agency
  for delete
  using (
    exists (
      select 1 from public.client_records cr
      where cr.id = client_record_id
        and cr.linked_user_id = auth.uid()
        and cr.link_status = 'linked'
    )
  );

-- updated_at 自動更新
create or replace function public.set_ddfa_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ddfa_updated_at on public.document_drafts_from_agency;
create trigger set_ddfa_updated_at
  before update on public.document_drafts_from_agency
  for each row execute function public.set_ddfa_updated_at();
