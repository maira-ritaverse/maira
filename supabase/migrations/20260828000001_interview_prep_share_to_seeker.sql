-- =====================================================================
-- 面談対策(interview_preps)の求職者への共有
--
-- 目的:
--   エージェントが生成した面談対策を、求職者本人が /app/interview-prep で
--   閲覧できるようにする(閲覧のみ。受領/辞退はしない = recommendation_letters と同型)。
--
-- 設計:
--   interview_preps には status 列が無く、生成即上書き(upsert on referral_id)なので、
--   「いつ共有したか」を表す shared_at を追加し、これが not null の行だけ求職者に見せる。
--   共有前(生成しただけ)は求職者に見えない。再生成で内容が変わったら、アプリ側で
--   shared_at を null に戻して「再共有」を必須にする(古い内容を誤って見せない)。
--
-- 公開範囲:
--   ・shared_at is not null のみ(共有済みだけ)
--   ・referral → client_records.linked_user_id = auth.uid() かつ link_status='linked'
--     (連携済の求職者本人のみ)
--
-- 既存 RLS への影響:
--   ・組織メンバー向け SELECT/INSERT/UPDATE/DELETE ポリシーはそのまま温存。
--   ・本ポリシーは追加 SELECT のみ(求職者は共有済みだけ閲覧可能)。
-- =====================================================================

alter table public.interview_preps
  add column if not exists shared_at timestamptz;

comment on column public.interview_preps.shared_at is
  '求職者へ共有した日時。not null の行だけ求職者本人が閲覧可能。再生成時はアプリ側で null に戻す。';

drop policy if exists "Linked seekers can view shared interview preps"
  on public.interview_preps;

create policy "Linked seekers can view shared interview preps"
  on public.interview_preps for select
  using (
    shared_at is not null
    and exists (
      select 1
      from public.referrals r
      join public.client_records c on r.client_record_id = c.id
      where r.id = interview_preps.referral_id
        and c.linked_user_id = auth.uid()
        and c.link_status = 'linked'
    )
  );

comment on policy "Linked seekers can view shared interview preps"
  on public.interview_preps is
  '連携済求職者本人は自分宛の共有済み(shared_at not null)面談対策を閲覧可能';
