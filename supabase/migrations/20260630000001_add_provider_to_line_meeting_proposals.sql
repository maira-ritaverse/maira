-- ============================================
-- line_meeting_proposals.provider 列 追加
--
-- これ まで postback (求職者 が 候補 を 選んだ 時) は 必ず Zoom 会議 を
-- 作成 して いた が、 エージェント が 提案 時 に Zoom / Google Meet を
-- 選べる ように する ため。
--
-- 既存 行 は 'zoom' で 後方 互換。
-- ============================================

alter table public.line_meeting_proposals
  add column if not exists provider text not null default 'zoom'
    check (provider in ('zoom', 'google_meet'));

comment on column public.line_meeting_proposals.provider is
  '候補 選択 時 に 作成 する 会議 の プロバイダ (zoom / google_meet)。';
