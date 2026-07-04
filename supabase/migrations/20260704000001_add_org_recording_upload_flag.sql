-- =====================================================================
-- 組織 単位 の 「録音 手動 アップロード」 機能 フラグ
--
-- 目的:
--   ・録音 アップロード → Whisper 転写 → Claude 抽出 の パイプ ラインは Anthropic
--     API 呼び出し + Storage 保存 の 実 コスト が 掛かる ため、 デフォルト 無効。
--   ・運営 (Maira admin) が 明示 的 に 有効 化 した 組織 のみ 使える 運用。
--
-- フラグ の 参照:
--   ・API: POST /api/agency/clients/[id]/intake-recording で 事前 チェック
--   ・UI:  /agency/clients/[id] の 「AI ヒアリング」 タブ で アップロード ボタン を
--          非 活性 化 + 「運営 承認 待ち」 の 案内 を 表示
--
-- 将来 の 拡張 余地:
--   ・Zoom / Meet 自動 連携 は 別 フラグ (recording_auto_integration_enabled) を
--     新設 予定 (現在 は 未 実装)
--
-- RLS: 既存 organizations テーブル の RLS が そのまま 適用 される。
--   SELECT: 同 org メンバー のみ (自組織 の 有効/無効 状態 は 見せて OK)
--   UPDATE: 運営 (service_role or is_maira_admin) のみ (API 側 で 検証)
-- =====================================================================

alter table public.organizations
  add column if not exists recording_upload_enabled boolean not null default false;

comment on column public.organizations.recording_upload_enabled is
  '録音 手動 アップロード 機能 を 有効 化 した か。 デフォルト false。 運営 が /admin/organizations 画面 から 個別 に 切替。';

-- 有効 化 済み 組織 の 一覧 抽出 を 高速 に する 用 (少ない はず なので 部分 index)
create index if not exists idx_organizations_recording_upload_enabled
  on public.organizations (id)
  where recording_upload_enabled = true;
