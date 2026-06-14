-- ============================================
-- クライアント(求職者)テーブル拡張(EMPRO 調査結果反映)
--
-- 現状の client_records は MVP の最小列構成(9列程度)。
-- EMPRO 調査(35列)から、エージェント業務に最も価値が高い 6 項目を追加する。
-- すべて NULL 許容で既存データを壊さない。
--
-- 暗号化対象(個人情報・業務メタ情報を含むため AES-256-GCM):
--   1. encrypted_recommendation_comment    推薦コメント(企業向け推薦文)
--   2. encrypted_other_agency_status       他社エージェント利用状況
--   3. encrypted_contact_method_preference 連絡方法希望(電話/メール/LINE等)
--
-- 平文 OK(検索・集計対象、機微性が低い):
--   4. close_reason            クローズ理由(enum でカテゴリ化、失注分析用)
--   5. entry_site              エントリーサイト(リクナビ/ビズリーチ等の出典)
--   6. email_distribution_enabled  メール配信 ON/OFF(配信抑制フラグ)
--
-- 暗号化フォーマットは Maira 標準("v{n}:base64url(iv ‖ ct+authTag)")。
-- lib/crypto/field-encryption.ts の encryptField/decryptField を経由する。
--
-- close_reason の値:
--   declined        他社サービス選択(競合に取られた)
--   self_arranged   自己応募・自力で決定
--   other_agency    他社エージェント経由で決定
--   unresponsive    連絡途絶
--   ineligible      条件不一致(マッチング不能)
--   completed       自社経由で転職完了(成約)
--   other           その他
-- ============================================

alter table public.client_records
  -- 暗号化フィールド
  add column if not exists encrypted_recommendation_comment text,
  add column if not exists encrypted_other_agency_status text,
  add column if not exists encrypted_contact_method_preference text,
  -- 平文フィールド
  add column if not exists close_reason text
    check (close_reason is null or close_reason in (
      'declined', 'self_arranged', 'other_agency',
      'unresponsive', 'ineligible', 'completed', 'other'
    )),
  add column if not exists entry_site text,
  add column if not exists email_distribution_enabled boolean not null default true;

comment on column public.client_records.encrypted_recommendation_comment is
  '推薦コメント(企業向け推薦文)。AES-256-GCM 暗号化。';
comment on column public.client_records.encrypted_other_agency_status is
  '他社エージェント利用状況。AES-256-GCM 暗号化。';
comment on column public.client_records.encrypted_contact_method_preference is
  '連絡方法希望(電話/メール/LINE 等)。AES-256-GCM 暗号化。';
comment on column public.client_records.close_reason is
  'クローズ理由のカテゴリ。declined/self_arranged/other_agency/unresponsive/ineligible/completed/other。失注分析用。';
comment on column public.client_records.entry_site is
  'エントリーサイト(リクナビ/ビズリーチ等)。集計分析用。';
comment on column public.client_records.email_distribution_enabled is
  'メール配信 ON/OFF。MA 自動配信もこのフラグを尊重する(false なら送らない)。';

-- close_reason の集計クエリが多くなる想定でインデックスを切る(NULL は除外)
create index if not exists idx_client_records_close_reason
  on public.client_records(close_reason)
  where close_reason is not null;
