-- =====================================================================
-- 監査 M1 対応: Zoom download_token を DB に 平文 で 保存 して いた 問題 の 修正
--
-- 従来: external_download_url に "${url}?access_token=${download_token}" を そのまま 保存
--   → zoom_connections の access/refresh は AES-256-GCM 暗号化 済 な のに、
--     同等 の Zoom credential (bearer 相当) だけ 平文 に なって いる 一貫 性 欠如。
--     CLAUDE.md 明示 の 「平文 を DB に 保存 しない」 に 抵触。
--
-- 修正: encrypted_download_token 列 を 新設。 external_download_url に は 生 URL
--   のみ 保存 し、 token は 分離 して 暗号化 保存 する。 pickup 側 で 復号 して
--   Authorization ヘッダ に 付ける。
-- =====================================================================

alter table public.career_intake_recordings
  add column if not exists encrypted_download_token text;

comment on column public.career_intake_recordings.encrypted_download_token is
  'Zoom / 外部 サービス の 短命 download token を AES-256-GCM で 暗号化 保存 (v{n}:base64url)。 M1 修正。';
