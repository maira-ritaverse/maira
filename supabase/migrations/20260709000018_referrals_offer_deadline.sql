-- ============================================================================
-- referrals.offer_deadline_at:内定 回答 期限
--
-- 目的:
--   ・status = 'offer' の 応募 で 「回答 期限」 を 保存 し、 期限 超過 = 内定
--     失効 の 損失 を UI で 事前 警告 する。
--   ・カレンダー に 「回答 期限」 チップ (kind = 'offer_deadline') として 表示。
--
-- 設計判断:
--   ・NULL 許容 (期限 未 設定 の 内定 も 業界 では 一般的)。
--   ・status = 'offer' の 場合 のみ 意味 を 持つ が、 status 遷移 で 消える と 損失
--     の 履歴 が 追え なく なる ため CHECK 制約 は 付け ない。 「内定 に なった 時 に
--     入力 する」 UI 側 の 運用 で 十分。
--   ・timestamptz。 タイム ゾーン を 揃えて 「YYYY-MM-DD 何時 まで」 を 明示。
-- ============================================================================

alter table public.referrals
  add column if not exists offer_deadline_at timestamptz;

comment on column public.referrals.offer_deadline_at is
  '内定 回答 期限。 status = ''offer'' の 応募 で 使う。 NULL = 期限 未 設定。 カレンダー に kind = ''offer_deadline'' として 表示 する。';

-- 期限 が 近い 応募 を 検索 する ため の インデックス (WHERE 句 で 絞る)
create index if not exists idx_referrals_offer_deadline
  on public.referrals (organization_id, offer_deadline_at)
  where offer_deadline_at is not null;
