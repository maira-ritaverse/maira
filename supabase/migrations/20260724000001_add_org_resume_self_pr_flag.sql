-- ============================================
-- 履歴書エディタで「自己PR」欄を使うかの組織単位フラグ
--
-- エージェント(会社)によって自己PRを使う/使わないが分かれるため、組織単位で
-- オン/オフを保持する。既定は false(オフ)。履歴書エディタのトグルで切り替え、永続化する。
-- 自己PR自体は履歴書PDFには出力されず、「求職者本人に送付」時のみ引き継がれる項目。
-- 既存の organizations.recording_upload_enabled と同じ「真偽値カラム」方式。
-- ============================================
alter table public.organizations
  add column if not exists resume_self_pr_enabled boolean not null default false;

comment on column public.organizations.resume_self_pr_enabled is
  '履歴書エディタで自己PR欄を使うか(組織単位、既定 false)。エディタのトグルで切替、永続化。';
