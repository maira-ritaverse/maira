-- =====================================================================
-- 推薦文(recommendation_letters)の求職者側 SELECT ポリシー
--
-- 目的:
--   求職者本人が「自分について書かれた推薦文」を /app/recommendation-letters
--   で閲覧できるようにする。
--
-- 公開範囲:
--   ・status = 'finalized' のみ(draft は社内編集中なので求職者に見せない)
--   ・referral → client_records.linked_user_id = auth.uid() のものに限定
--     (連携済の求職者本人のみ)
--
-- 既存 RLS への影響:
--   ・組織メンバー向け SELECT ポリシーはそのまま温存(同組織は全件閲覧)。
--   ・このポリシーは追加 SELECT。求職者は finalized のみ閲覧可能、
--     エージェント側の自由度を損なわない。
--
-- 設計判断:
--   推薦文は本人の経歴・志望理由を含む機微情報だが、本人の権利として
--   見られるべき情報。第三者(他求職者・他組織)からは引き続き完全に
--   見えない(RLS で organization_id 境界が効く)。
-- =====================================================================

drop policy if exists "Linked seekers can view finalized recommendation letters"
  on public.recommendation_letters;

create policy "Linked seekers can view finalized recommendation letters"
  on public.recommendation_letters for select
  using (
    status = 'finalized'
    and exists (
      select 1
      from public.referrals r
      join public.client_records c on r.client_record_id = c.id
      where r.id = recommendation_letters.referral_id
        and c.linked_user_id = auth.uid()
        and c.link_status = 'linked'
    )
  );

comment on policy "Linked seekers can view finalized recommendation letters"
  on public.recommendation_letters is
  '連携済求職者本人は自分宛の finalized 推薦文を閲覧可能(draft は閲覧不可)';
