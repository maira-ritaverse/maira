-- ============================================
-- AI 求人推薦 の 組織 別 設定 (プリセット + 求職者側 適用フラグ)
--
-- 用途:
--   ・エージェント企業 admin が 「AI が 求人 を おすすめ する 際 の 傾き」 を
--     プリセット から 選ぶ
--     ・fit_focused (既定): 求職者 の フィット 最優先 (placement_fee は 使わない)
--     ・balanced:            fit を 主軸 に fee を 副次的 に 考慮
--     ・fee_focused:         fee を 強く 重視 する が fit は 最低ライン を 保つ
--   ・apply_to_seeker_view: 既定 false。 true に すると 求職者本人 の
--     マイページ 推薦 (/api/me/job-recommendations) にも 反映 される。
--     倫理的 に 慎重 な 選択 な ので、 UI で 明示的 な 説明 と opt-in 動作 に する。
--
-- スキーマ:
--   ・(organization_id) を PK に する (組織 につき 1 行)
--   ・preset は text + check 制約
--   ・updated_by_user_id を 監査 に 使う (auth.users(id) は set null)
--
-- セキュリティ:
--   ・SELECT: 組織 メンバー 全員 (レポート や 推薦 画面 で 参照)
--   ・INSERT / UPDATE / DELETE: admin のみ
-- ============================================

create table if not exists public.organization_ai_recommendation_settings (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,

  preset text not null default 'fit_focused',
  apply_to_seeker_view boolean not null default false,

  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint org_ai_reco_preset_check
    check (preset in ('fit_focused', 'balanced', 'fee_focused'))
);

comment on table public.organization_ai_recommendation_settings is
  'AI 求人推薦 の 組織別 プリセット 設定。 未設定 の 組織 は 既定 (fit_focused) 扱い。';
comment on column public.organization_ai_recommendation_settings.preset is
  'fit_focused (既定) / balanced / fee_focused の 3 プリセット。';
comment on column public.organization_ai_recommendation_settings.apply_to_seeker_view is
  'true の とき 求職者本人 向け 推薦 (/api/me/job-recommendations) にも 反映 される。 既定 false。';

alter table public.organization_ai_recommendation_settings enable row level security;

-- SELECT: 組織 メンバー 全員
create policy org_ai_reco_select_member
  on public.organization_ai_recommendation_settings for select
  using (organization_id = public.current_user_organization_id());

-- INSERT: admin のみ
create policy org_ai_reco_insert_admin
  on public.organization_ai_recommendation_settings for insert
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- UPDATE: admin のみ
create policy org_ai_reco_update_admin
  on public.organization_ai_recommendation_settings for update
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  )
  with check (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );

-- DELETE: admin のみ (reset 用)
create policy org_ai_reco_delete_admin
  on public.organization_ai_recommendation_settings for delete
  using (
    organization_id = public.current_user_organization_id()
    and public.current_user_organization_role() = 'admin'
  );
