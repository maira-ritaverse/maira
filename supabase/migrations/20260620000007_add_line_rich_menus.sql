-- ============================================
-- LINE Rich Menu 設定 (line_channels 拡張)
--
-- 仕様:
--   ・LINE Developers コンソール で Rich Menu を 事前作成 (画像 + tap areas)
--   ・Maira では Rich Menu ID 2 つ を 保存:
--     - default_rich_menu_id    : 未連携 友達 用 (例: 「連携 コード を 入力」誘導)
--     - linked_rich_menu_id     : 連携済 client_record 用 (例: 「求人を見る」「面談予約」)
--   ・Webhook で link_method='code' 等 確定時 に Per-User で linked_rich_menu_id を 切替
-- ============================================

alter table public.line_channels
  add column if not exists default_rich_menu_id text,
  add column if not exists linked_rich_menu_id text;

comment on column public.line_channels.default_rich_menu_id is
  'LINE デフォルト リッチメニュー ID (未連携 友達 が 見る)。';
comment on column public.line_channels.linked_rich_menu_id is
  'client_records に 紐付け された 友達 用 リッチメニュー ID。';
