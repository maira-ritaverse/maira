-- 求職者 (client_records) に 対する 「副 担当」 / 共同 担当 の 紐付け 表。
--
-- 仕様:
--   ・主 担当 は 既存 の client_records.assigned_member_id を 引き続き 使う
--   ・副 担当 は 1 求職者 × N 名 で 並行 保持 ( 同 組織 内 advisor )
--   ・主 担当 と 同じ メンバー を 副 担当 に も 入れる 行為 は アプリ 層 で 防ぐ
--     ( DB 側 で 強制 すると 担当 切替 と の 競合 で 失敗 する ので、 application-level )
--   ・追加 / 削除 履歴 は 監査 ログ (member_audit_log) に 残す
--
-- RLS:
--   ・SELECT: 同 組織 全 メンバー
--   ・INSERT / DELETE: 同 組織 全 メンバー ( admin / 主 担当 / 副 担当 本人 ) を 想定
--     DB 側 は 「同 組織 内」 まで で 緩く 許可 し、 細かい 権限 は アプリ 層 で 制限。
--     ( RLS で 細かく 書く と 引き継ぎ 操作 が 失敗 する など 取り回し が 悪い )

create table if not exists client_record_collaborators (
  client_record_id uuid not null
    references client_records(id) on delete cascade,
  member_id uuid not null
    references organization_members(id) on delete cascade,
  added_by_member_id uuid
    references organization_members(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (client_record_id, member_id)
);

-- 「自分 が 副 担当 で 関わって いる 求職者 を 一覧 する」 クエリ で 使う
create index if not exists client_record_collaborators_member_idx
  on client_record_collaborators (member_id);

alter table client_record_collaborators enable row level security;

-- 同 組織 メンバー の 求職者 に 紐付く 行 を 閲覧 可能
create policy "collaborators_select_same_org"
  on client_record_collaborators for select
  using (
    exists (
      select 1 from client_records cr
      where cr.id = client_record_collaborators.client_record_id
        and cr.organization_id in (
          select organization_id from organization_members
          where user_id = auth.uid()
        )
    )
  );

-- 同 組織 メンバー が 追加 可能 ( 細かい 権限 制御 は API 層 )
create policy "collaborators_insert_same_org"
  on client_record_collaborators for insert
  with check (
    exists (
      select 1 from client_records cr
      where cr.id = client_record_collaborators.client_record_id
        and cr.organization_id in (
          select organization_id from organization_members
          where user_id = auth.uid()
        )
    )
  );

-- 同 組織 メンバー が 削除 可能 ( 細かい 権限 制御 は API 層 )
create policy "collaborators_delete_same_org"
  on client_record_collaborators for delete
  using (
    exists (
      select 1 from client_records cr
      where cr.id = client_record_collaborators.client_record_id
        and cr.organization_id in (
          select organization_id from organization_members
          where user_id = auth.uid()
        )
    )
  );

comment on table client_record_collaborators is
  '求職者 (client_records) に 対する 副 担当 / 共同 担当 の 紐付け。 主 担当 は client_records.assigned_member_id。';
