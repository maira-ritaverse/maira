-- ============================================================================
-- meeting_schedules を 「手動 予定」 でも 使える よう に 制約 緩和
--
-- 背景:
--   ・ 現行 は provider = 'zoom' / 'google_meet' のみ、 external_meeting_id は
--     NOT NULL で、 「実 会議 提供 者 経由 で 作成 した 予定」 だけ を 想定。
--   ・ カレンダー UI か ら 手動 で 「電話 会議 / 対面 面談 / 備忘 予定」 を 追加
--     する 動線 を 加える に は、 provider に 'manual' を 許容 し、
--     external_meeting_id を NULL 許容 に する 必要 が ある。
--
-- 設計判断:
--   ・ join_url も NULL 許容 に する (対面 面談 なら URL 不要)。
--   ・ external_meeting_id の 一意 制約 (idx_meeting_schedules_provider_external_unique)
--     は WHERE 句 で NULL を 除外 する 形 に 変更 し、 provider='manual' で NULL
--     が 複数 存在 でき る よう に する。
--   ・ 既存 の Zoom / Meet 予定 に 影響 なし (RLS / トリガ / 他 索引 は 触ら ない)。
-- ============================================================================

-- 制約 の 差し替え: provider に 'manual' を 追加
alter table public.meeting_schedules
  drop constraint if exists meeting_schedules_provider_check;

alter table public.meeting_schedules
  add constraint meeting_schedules_provider_check
    check (provider in ('zoom', 'google_meet', 'manual'));

-- external_meeting_id を NULL 許容 に (manual の 場合 は 外部 ID 無し)
alter table public.meeting_schedules
  alter column external_meeting_id drop not null;

-- join_url も NULL 許容 に (対面 面談 は URL 無し)
alter table public.meeting_schedules
  alter column join_url drop not null;

-- 一意 索引 を WHERE 句 付き で 貼り 直し (NULL は 除外、 複数 NULL を 許容)
drop index if exists idx_meeting_schedules_provider_external_unique;
create unique index if not exists idx_meeting_schedules_provider_external_unique
  on public.meeting_schedules (provider, external_meeting_id)
  where external_meeting_id is not null;

comment on column public.meeting_schedules.provider is
  'zoom / google_meet / manual。 manual は カレンダー から 手動 で 追加 した 予定 (対面 / 電話 / 備忘)。';
comment on column public.meeting_schedules.external_meeting_id is
  'Zoom / Meet の 外部 会議 ID。 provider=manual の 場合 は NULL。';
