# Maira

20-30代の転職活動者向けの AI 採用エージェントとそれを支援するエージェント企業向け管理画面を提供する Web アプリ(PWA)。

主な構成:

- **BtoC**:求職者向けのキャリア棚卸し / 書類作成 / 応募管理 / 音声面接(将来)
- **BtoB(agency)**:紹介エージェント向けの CRM/ATS。クライアント管理・求人管理・選考管理・MA・KPI レポート

## 技術スタック

- Next.js 15(App Router) + TypeScript
- Tailwind CSS + shadcn/ui v4(`@base-ui/react` 基盤)
- Supabase(PostgreSQL + Auth + Edge Functions)
- Anthropic API(Claude Sonnet)
- Stripe Subscription / Resend(メール送信)
- Vercel(ホスティング) / Cloudflare(DNS)
- 暗号化:Web Crypto API による AES-256-GCM(外部ライブラリ不使用)

詳細・運用ルールは [CLAUDE.md](./CLAUDE.md) を参照。

## Getting Started

```bash
pnpm install
pnpm dev
```

http://localhost:3000 にアクセス。

開発用環境変数は `.env.local` に設定(コミット禁止)。最低限必要なもの:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `FIELD_ENCRYPTION_KEYS=`{"v1":"<base64-32byte>"}`/`FIELD_ENCRYPTION_CURRENT_VERSION=v1`
- (任意)`RESEND_API_KEY` / `EMAIL_FROM`(MA・招待メールの実送信に使用)

## テスト・型チェック

```bash
pnpm test       # vitest(純粋関数のユニットテスト)
pnpm tsc --noEmit
pnpm eslint .
```

## 主な機能ドキュメント

| 機能                                   | ガイド                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------- |
| **マーケティングオートメーション(MA)** | [docs/ma-ops-guide.md](./docs/ma-ops-guide.md)                             |
| EMPRO 機能調査(設計参考)               | [docs/research/empro-survey.md](./docs/research/empro-survey.md)           |
| 暗号化バックフィル運用記録             | [docs/encryption-backfill-report.md](./docs/encryption-backfill-report.md) |
| プロジェクト全体の運用ルール           | [CLAUDE.md](./CLAUDE.md)                                                   |

## MA(マーケティングオートメーション)概要

エージェント企業が **シナリオに沿った自動メール配信**を運用するための機能群。Phase C-1〜C-3 で実装。

### サブ機能

- **シナリオプリセット(7 種)**:登録者への面談促進 / 面談前リマインド / 求人紹介 / 休眠求職者掘り起こし / 面接後フォロー / 入社後フォロー / 誕生日のあいさつ
- **テンプレ編集UI**:変数挿入型(`{{candidate_name}}` 等 11 種)+ サンプル値プレビュー
- **テスト送信**:1 通だけ任意のメアドに送信して動作確認
- **送信履歴**:`/agency/marketing/logs` で復号表示、CSV エクスポート可能
- **配信特約モデル**:法令遵守の特約に同意・撤回を組織単位で記録
- **配信抑制**:求職者単位の `email_distribution_enabled` フラグで MA から除外

### 配信実行

`supabase/functions/ma-send-campaign/` を pg_cron + net.http_post で 1 日 1 回起動する設計。詳細とデプロイ手順は [docs/ma-ops-guide.md](./docs/ma-ops-guide.md) を参照。

## デプロイ

- **Web**:Vercel(`feat/*` ブランチで PR、main マージで本番反映)
- **DB**:`supabase db push`(dev は自動、prod はユーザー明示指示後のみ)
- **Edge Function**:`supabase functions deploy ma-send-campaign`(MA 運用時)

詳細手順は [docs/ma-ops-guide.md](./docs/ma-ops-guide.md) の「3. デプロイ手順」セクション参照。
