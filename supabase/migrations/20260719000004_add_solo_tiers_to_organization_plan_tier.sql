-- =====================================================================
-- organization_plan_tier enum に solo / solo_pro を追加 (Solo プラン Phase 1)
--
-- 目的:
--   個人事業主 / フリー エージェント 向け の Solo プラン (¥5,980/月、 1 席、
--   AI 100 回) と Solo Pro プラン (¥9,800/月、 1 席、 AI 200 回、 CSV 一括 +
--   優先サポート + 詳細レポート 等 の 付加機能) の 基盤 を 用意 する。
--
--   本 migration で は enum に 値 を 追加 する のみ。 誰も まだ Solo tier で
--   発行 されない (POST /api/self-serve/... の セルフサーブ 導線 は 未実装、
--   Stripe Product/Price も 未設定) ので、 挙動 は 変わら ない。
--
-- 経緯:
--   ・organization_plan_tier は Postgres enum で 定義 されて いる (2026-06-20
--     の 20260620000002_add_organization_plans.sql:31)
--   ・enum に 値 を 追加 する のは 「alter type ... add value」の みで OK
--   ・drop / recreate は FK 参照 を 壊す ので 使わ ない
--   ・alter type add value は 「トランザクション の 中 で 追加した 値 を 使う」
--     こと が できない 制約 が ある (Postgres の 仕様)。 本 migration は
--     enum 拡張 のみ で 使用 は しない ので 問題 なし
--
-- 適用 後 の 追加 作業:
--   ・pnpm supabase:types で database.types.ts を 再生成 (dev 適用後)
--     もし 自動 生成 が 動か なければ 手動 で database.types.ts の
--     organization_plan_tier リテラル に "solo" | "solo_pro" を 追加 する
--     (本 コミット で は 手動 追加 済 の 状態 で push、 CI で 齟齬 が 出たら
--      再生成 で 上書き)
--
-- 適用:
--   dev / prod 共 に Supabase Dashboard の SQL Editor から 手動 適用。
-- =====================================================================

-- Solo プラン (¥5,980/月、 1 席、 AI 100 回)
alter type public.organization_plan_tier add value if not exists 'solo';

-- Solo Pro プラン (¥9,800/月、 1 席、 AI 200 回 + 付加機能)
alter type public.organization_plan_tier add value if not exists 'solo_pro';
