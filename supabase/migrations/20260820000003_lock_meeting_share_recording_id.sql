-- =====================================================================
-- meeting_interview_shares.recording_id / meeting_schedule_id を seeker から不変にする
--
-- 背景:
--   面談共有の承認(PATCH /api/me/meeting-shares/[id] action=accept)は、抽出 JSON を
--   保持する career_intake_recordings(所有者=エージェントのみ RLS 可読)を、共有が本人の
--   ものだと検証した後に service client で読む(recording_id にスコープ)。
--
--   しかし meeting_interview_shares の UPDATE RLS ポリシーは seeker_user_id 一致のみを見て
--   おり列制限が無く、既存の immutability トリガ(20260708000003)も
--   expires_at / share_token / seeker_user_id / organization_id しか保護していなかった。
--   このため seeker が PostgREST 直叩きで自分の share の recording_id を他人の録音 UUID に
--   差し替え → accept で service client が他人の抽出 PII を復号し自分のプロフィールに
--   取り込める、という IDOR の余地があった(UUID 非推測 + recording_id UNIQUE 制約で
--   実悪用は強く抑制されるが、認可境界が RLS からアプリ前提に後退していた)。
--
-- 対応:
--   発行側(エージェント)が設定する recording_id / meeting_schedule_id も seeker からの
--   直接 UPDATE では変更不可にする。service_role(サーバーの正規処理)は従来どおり免除。
--   seeker が直接変更してよいのは status / responded_at / responded_message のみ。
--
-- 適用: まず dev(maira-dev)。prod はリリース時に別途明示指示で適用。
-- =====================================================================

create or replace function public.enforce_meeting_interview_shares_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  -- seeker が 直接 変更 できて い い の は status / responded_at / responded_message のみ。
  -- expires_at / share_token / seeker_user_id / organization_id / recording_id /
  -- meeting_schedule_id は 発行 側(エージェント)の 情報 で seeker からは 不変。
  if new.expires_at is distinct from old.expires_at then
    raise exception 'expires_at is immutable via direct update' using errcode = '42501';
  end if;
  if new.share_token is distinct from old.share_token then
    raise exception 'share_token is immutable' using errcode = '42501';
  end if;
  if new.seeker_user_id is distinct from old.seeker_user_id then
    raise exception 'seeker_user_id is immutable' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  if new.recording_id is distinct from old.recording_id then
    raise exception 'recording_id is immutable' using errcode = '42501';
  end if;
  if new.meeting_schedule_id is distinct from old.meeting_schedule_id then
    raise exception 'meeting_schedule_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
