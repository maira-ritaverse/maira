-- =====================================================================
-- クライアント変更履歴(client_audit_log)
--
-- CRM の信頼性 + 監査対応のための追記型ログ。
-- 「いつ・誰が・どの顧客の・どのフィールドを・何から何に変えた」を記録する。
--
-- ポリシー:
--   - 追記専用(UPDATE / DELETE はポリシー無し = 拒否)。
--   - SELECT は組織メンバーなら誰でも閲覧可(組織全体で透明性を確保)。
--   - INSERT は API ルートから明示的に呼ぶ。RLS で organization_id 一致を強制。
--   - 暗号化フィールドの値は old_value / new_value に保存しない
--     (復号した平文を残すのはセキュリティ要件に反する)。
--     field_name のみ記録し、UI 側で「※暗号化フィールド」と表示する。
--
-- 設計の妥協:
--   - 1 操作で複数フィールドが変わった場合は、フィールドごとに 1 行ずつ INSERT する。
--     (JSON にまとめる案もあるが、フィールド単位での絞り込み / 集計がしやすい)。
-- =====================================================================

create table if not exists public.client_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  -- 操作した人(null = システム / バッチ / cron)
  actor_member_id uuid references public.organization_members(id) on delete set null,
  -- 何を変えたか(プログラマブルな分類)
  action text not null check (action in ('create', 'update', 'delete')),
  -- 変更されたフィールド名(snake_case の DB 列名 or 論理名)。
  -- create / delete 時は 'record' を入れる(全体イベントを意味する)。
  field_name text not null,
  -- 旧値 / 新値(平文フィールドのみ。暗号化対象は null + flag を立てない設計)。
  -- 長文を扱う可能性があるので text。サイズが膨らんだら別カラムに分離する余地あり。
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

comment on table public.client_audit_log is
  'クライアント変更履歴(追記型)。組織全体に閲覧公開、INSERT のみ可';
comment on column public.client_audit_log.field_name is
  'DB 列名 or 論理イベント名(create/delete 時は ''record'')';
comment on column public.client_audit_log.old_value is
  '旧値(暗号化フィールドは保存しない、null)';

-- 顧客 ID + 時刻降順で読みたいので副インデックス
create index if not exists client_audit_log_client_created_idx
  on public.client_audit_log (client_record_id, created_at desc);

-- 組織全体の「最近の変更」一覧用
create index if not exists client_audit_log_org_created_idx
  on public.client_audit_log (organization_id, created_at desc);

-- ===========================
-- RLS
-- ===========================
alter table public.client_audit_log enable row level security;

-- SELECT:同組織メンバーなら閲覧可
drop policy if exists "Org members can view client audit log" on public.client_audit_log;
create policy "Org members can view client audit log"
  on public.client_audit_log for select
  using (organization_id = public.current_user_organization_id());

-- INSERT:同組織のメンバーであることを必須化
-- actor_member_id は null(システム経由)を許容するため厳密一致は要求しない。
-- API ルート側で「actor_member_id = 呼び出し元の member.id」を明示セットする運用。
drop policy if exists "Org members can insert client audit log" on public.client_audit_log;
create policy "Org members can insert client audit log"
  on public.client_audit_log for insert
  with check (organization_id = public.current_user_organization_id());

-- UPDATE / DELETE はポリシー無し = 拒否(追記専用ログのため)
