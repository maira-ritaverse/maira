-- ============================================================================
-- meeting_interview_shares を「面談予約に紐づかない録音」も扱えるよう拡張
--
-- 背景:
--   ・エージェントが「クライアントを指定して」単発で音声をアップロードし、
--     抽出結果を本人レビューに回すフローを追加(meeting_schedule_id 無し)
--   ・既存の RLS は meeting_schedule_id 経由で「host か否か」を判定していたが、
--     これは meeting_schedule_id NULL の行で機能しない
--
-- 変更:
--   1. meeting_schedule_id を NULLABLE 化
--   2. ホスト判定の RLS を以下のように拡張:
--      ・meeting_schedule_id が NULL のとき → recording 経由でアップロード者を辿る
--      ・recording.user_id が auth.uid() なら host とみなす
--      (career_intake_recordings.user_id は「行を作ったユーザ」=エージェント
--       本人もしくは求職者本人。エージェントがアップロードした場合は組織メンバ)
-- ============================================================================

alter table public.meeting_interview_shares
  alter column meeting_schedule_id drop not null;

-- ─── ポリシー再定義 ────────────────────────────────────────────────────
drop policy if exists "Members and seeker can view share" on public.meeting_interview_shares;
create policy "Members and seeker can view share"
  on public.meeting_interview_shares for select
  using (
    seeker_user_id = auth.uid()
    or exists (
      select 1 from public.meeting_schedules ms
      where meeting_interview_shares.meeting_schedule_id is not null
        and ms.id = meeting_interview_shares.meeting_schedule_id
        and (
          ms.host_user_id = auth.uid()
          or ms.organization_id = public.current_user_organization_id()
        )
    )
    or exists (
      select 1 from public.career_intake_recordings r
      where r.id = meeting_interview_shares.recording_id
        and r.user_id = auth.uid()
    )
  );

drop policy if exists "Host can insert share" on public.meeting_interview_shares;
create policy "Host can insert share"
  on public.meeting_interview_shares for insert
  with check (
    (
      meeting_interview_shares.meeting_schedule_id is not null
      and exists (
        select 1 from public.meeting_schedules ms
        where ms.id = meeting_interview_shares.meeting_schedule_id
          and ms.host_user_id = auth.uid()
      )
    )
    or exists (
      select 1 from public.career_intake_recordings r
      where r.id = meeting_interview_shares.recording_id
        and r.user_id = auth.uid()
    )
  );

drop policy if exists "Host or admin can delete share" on public.meeting_interview_shares;
create policy "Host or admin can delete share"
  on public.meeting_interview_shares for delete
  using (
    (
      meeting_interview_shares.meeting_schedule_id is not null
      and exists (
        select 1 from public.meeting_schedules ms
        where ms.id = meeting_interview_shares.meeting_schedule_id
          and (
            ms.host_user_id = auth.uid()
            or (
              ms.organization_id = public.current_user_organization_id()
              and public.current_user_organization_role() = 'admin'
            )
          )
      )
    )
    or exists (
      select 1 from public.career_intake_recordings r
      where r.id = meeting_interview_shares.recording_id
        and r.user_id = auth.uid()
    )
  );
