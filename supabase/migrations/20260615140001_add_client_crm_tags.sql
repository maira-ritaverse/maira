-- =====================================================================
-- クライアント自由タグ(crm_tags)
--
-- EMPRO 拡張の experience_industries / desired_industries は「業務上の構造化軸」
-- (検索キー化された業種 / 職種)であり、自由テキストではない。
-- ここで追加する crm_tags は CRM 運用上の「フラグ」用途:
--   例:「VIP」「要フォロー」「上場志望」「経験者紹介経由」「セミナー参加者」
-- 組織ごとに用語が違っても自由に運用できるよう、enum 等の制約を入れない。
--
-- 設計:
--   - text[] 配列。空配列がデフォルト(NULL ではない)。
--   - GIN インデックスで「特定タグを含む顧客の絞り込み」を高速化。
--   - RLS は client_records と一体(列追加のみで policy は追加不要)。
-- =====================================================================

alter table public.client_records
  add column if not exists crm_tags text[] not null default '{}'::text[];

comment on column public.client_records.crm_tags is
  'CRM 運用フラグ用の自由タグ(VIP / 要フォロー / 上場志望 等)。組織ごとに自由運用。';

-- 「タグ X を持つ顧客の絞り込み」を高速化(@> / && 演算子)。
create index if not exists client_records_crm_tags_gin_idx
  on public.client_records using gin (crm_tags);
