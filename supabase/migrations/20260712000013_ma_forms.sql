-- ============================================
-- forms + form_submissions
--
-- 目的:
--   公式 LINE 友だち追加後の追加ヒアリング(氏名 / 希望条件 / 転職時期 等)を
--   Web フォームで受け付ける最小機能。送信を CV Flow のトリガーにする。
--
-- 設計:
--   ・forms:公開状態と質問(schema_json) を保持。token で公開 URL を発行。
--   ・form_submissions:回答は暗号化(AES-256-GCM、encrypted_answers)。
--     Individual answers ではなく JSONB を一括暗号化(質問数が可変で index も不要)。
--   ・LINE 連携済みの求職者から送られた場合は line_user_id を紐付け → Flow 起動
--     可能に。
--   ・LINE 未連携の submit も受け付ける(Flow は起動しないが、レコードは残す)。
-- ============================================

-- 1. forms
create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,

  title text not null,
  description text,

  -- 公開 URL 用のトークン(表示は /f/<token>)
  -- 32 文字のランダム識別子。組織横断でユニーク(グローバルネームスペース)。
  public_token text not null unique,

  -- 公開状態。false のときは公開ページを 404 にする。
  is_published boolean not null default false,

  -- 質問一覧(JSONB スキーマ)。質問数が可変なので別テーブルにしない選択。
  --   [{ "id": "q1", "kind": "text", "label": "お名前", "required": true },
  --    { "id": "q2", "kind": "textarea", "label": "ご相談内容", "required": false },
  --    { "id": "q3", "kind": "select", "label": "転職時期",
  --      "required": true, "options": ["すぐ", "3か月以内", "半年以内", "1年以上先"] }]
  schema_json jsonb not null default '[]'::jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.forms is
  '公開 Web フォーム。 公式 LINE 友だち追加後のヒアリング用。 submit で CV Flow を起動する。';

create index if not exists idx_forms_org on public.forms (organization_id);
create index if not exists idx_forms_token on public.forms (public_token);

-- updated_at 自動更新
create or replace function public.forms_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists forms_touch_updated_at on public.forms;
create trigger forms_touch_updated_at
  before update on public.forms
  for each row execute function public.forms_touch_updated_at();

-- RLS
alter table public.forms enable row level security;

create policy "forms_select_own_org"
  on public.forms for select
  using (organization_id = public.current_user_organization_id());

create policy "forms_insert_own_org"
  on public.forms for insert
  with check (organization_id = public.current_user_organization_id());

create policy "forms_update_own_org"
  on public.forms for update
  using (organization_id = public.current_user_organization_id())
  with check (organization_id = public.current_user_organization_id());

create policy "forms_delete_own_org"
  on public.forms for delete
  using (organization_id = public.current_user_organization_id());

-- 2. form_submissions
create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  form_id uuid not null
    references public.forms(id) on delete cascade,

  -- 送信者(LINE 連携済みなら埋まる、未連携 or 匿名なら null)
  line_user_id text,
  client_record_id uuid references public.client_records(id) on delete set null,

  -- 回答本体。 AES-256-GCM で暗号化した JSONB を base64 で保存。
  --   復号後: { "q1": "山田太郎", "q2": "...", "q3": "3か月以内" }
  encrypted_answers text not null,

  -- 送信時刻(occurred_at)。 CV Flow の occurred_at 引数に使う。
  submitted_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);

comment on table public.form_submissions is
  'フォーム 送信 履歴。 encrypted_answers に 回答 JSONB を AES-256-GCM 暗号化 して 保存。';

create index if not exists idx_form_submissions_form_time
  on public.form_submissions (form_id, submitted_at desc);
create index if not exists idx_form_submissions_org_time
  on public.form_submissions (organization_id, submitted_at desc);
create index if not exists idx_form_submissions_line_user
  on public.form_submissions (organization_id, line_user_id)
  where line_user_id is not null;

-- RLS
alter table public.form_submissions enable row level security;

-- SELECT のみ自組織メンバー可。INSERT / UPDATE / DELETE は service_role のみ
-- (公開フォームは匿名 POST を受け付けるため、公開エンドポイントで service_role
-- を使って INSERT する)
create policy "form_submissions_select_own_org"
  on public.form_submissions for select
  using (organization_id = public.current_user_organization_id());
