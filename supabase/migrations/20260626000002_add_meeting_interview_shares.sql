-- ============================================================================
-- meeting_interview_shares:エージェント面談で抽出した職務経歴データを
-- 求職者にレビュー / 同意してもらう中間テーブル
--
-- 流れ:
--   1) エージェントが録画→文字起こし→抽出 まで完了したら、
--      meeting_interview_shares 行を 'pending' で作成
--   2) 求職者本人に通知 → ダッシュボードで内容確認 → 「反映」or「拒否」
--   3) 'accepted' で承認した内容は career_profile にマージするフローへ
--
-- 暗号化:
--   ・extraction の中身は career_intake_recordings.encrypted_extraction に既に
--     暗号化済みなので、ここでは recording_id 参照だけ持つ(二重暗号化を避ける)
--   ・review_message(エージェントから求職者へのメッセージ)は機微寄りなので
--     暗号化保存
--
-- RLS:
--   ・SELECT:同組織メンバ + 求職者本人
--   ・INSERT:エージェント本人(host)
--   ・UPDATE(accepted/rejected):求職者本人のみ
--   ・DELETE:エージェント本人 or 組織 admin
-- ============================================================================

create table if not exists public.meeting_interview_shares (
  id uuid primary key default gen_random_uuid(),
  meeting_schedule_id uuid not null references public.meeting_schedules(id) on delete cascade,
  -- 求職者(必ず Maira アカウントを持つ前提。未登録なら共有しない)
  seeker_user_id uuid not null references auth.users(id) on delete cascade,
  -- 共有元データ
  recording_id uuid not null references public.career_intake_recordings(id) on delete cascade,
  -- エージェントから求職者へのメッセージ(暗号化)
  encrypted_review_message text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  -- accepted のときに career_profile への反映を 1 回だけ行うフラグ
  applied_to_career_profile_at timestamptz,
  responded_at timestamptz,
  -- 有効期限(送信から 30 日)
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_mis_recording_unique
  on public.meeting_interview_shares (recording_id);

create index if not exists idx_mis_seeker_status
  on public.meeting_interview_shares (seeker_user_id, status, created_at desc);

drop trigger if exists set_mis_updated_at on public.meeting_interview_shares;
create trigger set_mis_updated_at
  before update on public.meeting_interview_shares
  for each row execute function public.set_updated_at();

comment on table public.meeting_interview_shares is
  'エージェント面談で抽出した職務経歴データ。求職者の同意後に career_profile にマージ';

-- RLS
alter table public.meeting_interview_shares enable row level security;

drop policy if exists "Members and seeker can view share" on public.meeting_interview_shares;
create policy "Members and seeker can view share"
  on public.meeting_interview_shares for select
  using (
    seeker_user_id = auth.uid()
    or exists (
      select 1 from public.meeting_schedules ms
      where ms.id = meeting_interview_shares.meeting_schedule_id
        and (
          ms.host_user_id = auth.uid()
          or ms.organization_id = public.current_user_organization_id()
        )
    )
  );

drop policy if exists "Host can insert share" on public.meeting_interview_shares;
create policy "Host can insert share"
  on public.meeting_interview_shares for insert
  with check (
    exists (
      select 1 from public.meeting_schedules ms
      where ms.id = meeting_interview_shares.meeting_schedule_id
        and ms.host_user_id = auth.uid()
    )
  );

-- 求職者本人は status / responded_at だけ変更可。
-- それ以外のフィールド変更は service_role 経由(applied_to_career_profile_at をセットする処理など)。
drop policy if exists "Seeker can update share status" on public.meeting_interview_shares;
create policy "Seeker can update share status"
  on public.meeting_interview_shares for update
  using (seeker_user_id = auth.uid())
  with check (seeker_user_id = auth.uid());

drop policy if exists "Host or admin can delete share" on public.meeting_interview_shares;
create policy "Host or admin can delete share"
  on public.meeting_interview_shares for delete
  using (
    exists (
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
  );
