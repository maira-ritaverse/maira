# 本番ローンチ 残タスク 手順書

最終更新:2026-06-29

直近の コミット で 実装した もの と、運用 側で 手動 設定 が 必要な もの を 整理。
本番リリース 前に この ドキュメント を 上から 順に 消し込み ます。

---

## 1. ✅ Sentry 導入(コード側 完了)

### 実装内容(コード)

- `@sentry/nextjs` 10.x を 依存追加
- `sentry.server.config.ts` / `sentry.edge.config.ts` / `instrumentation.ts` / `instrumentation-client.ts`
- `next.config.ts` を `withSentryConfig` で ラップ
- 本番(`VERCEL_ENV=production`)でのみ 有効化、それ以外は 送信抑止

### 残タスク(運用)

- [ ] Sentry で 新規プロジェクト 作成
  - 1. https://sentry.io/ で アカウント作成 / ログイン
  - 2. New Project → 「Next.js」を 選択
  - 3. プロジェクト名 = `maira-prod`
  - 4. DSN を コピー(例:`https://abc123@oXXXX.ingest.sentry.io/12345`)
- [ ] Vercel 環境変数 設定(Production のみ)
  - `NEXT_PUBLIC_SENTRY_DSN` = Sentry から コピーした DSN
  - `SENTRY_ORG` = Sentry の Organization slug
  - `SENTRY_PROJECT` = `maira-prod`
  - `SENTRY_AUTH_TOKEN` = Sentry → Settings → Auth Tokens で 新規発行
    (Source Maps アップロードに 必要)
- [ ] 動作確認:本番デプロイ後 に 意図的に エラーを 起こして Sentry の Issues に 上がれば OK
      (`/api/internal/health-check-broken` 等を 一時的に 作って 試す)

---

## 2. ✅ Vercel Analytics(コード側 完了)

### 実装内容

- `@vercel/analytics` 2.x を 依存追加
- `app/layout.tsx` 内 で `<Analytics />` を 配置(`<body>` 末尾)

### 残タスク(運用)

- [ ] Vercel ダッシュボード → Analytics タブを 開いて Enable
- [ ] 初回 デプロイ後、数時間 で PV / Top Pages が 表示される

---

## 3. ✅ 特定商取引法 ページ(コード側 完了)

### 実装内容

- `app/(marketing)/legal/page.tsx` 新設
- 商取引法 必須項目 を 全網羅
- フッターリンクを `/terms`, `/privacy`, `/support` と 揃え

### 残タスク(運用)

- [ ] 代表者 氏名(現在 「新垣 ◯◯」プレースホルダ)を 正式名に 更新
- [ ] 所在地:「請求あり次第 遅滞なく 提示」運用 で OK か 法務確認
      (BtoC 課金 を 始める 前に Apple/Google の 審査 で 住所が 必要 と なる 可能性あり)
- [ ] 連絡先 メアド(`info@maira.pro`)が 実際に 届く か 動作確認
- [ ] 利用規約 / プライバシーポリシー の フッターに `/legal` リンクを 追加(現状 cross-link なし)

---

## 4. ✅ /contact → /support リダイレクト(コード側 完了)

### 実装内容

- `app/(marketing)/contact/page.tsx` から `/support` に 即時 redirect

既存 `/support` ページが お問い合わせ窓口 を 兼ねている ため。 launch-checklist の
`/contact` 要望 は これ で 満たす。

### 残タスク(運用)

- [ ] サポートメールの 動作確認(`info@maira.pro`)

---

## 5. ⚠️ Cron Secret 設定(運用 のみ)

### 背景

`vercel.json` で 2 つの cron 定義済:

- `/api/internal/career-intake/pickup` 5 分毎
- `/api/internal/meetings/reminders` 10 分毎

これら は `INTAKE_CRON_SECRET` 環境変数 を 持つ リクエスト のみ 受け付ける。

### 残タスク(運用)

- [ ] シークレット生成:`openssl rand -hex 32` (ローカルで 実行、64 字 hex)
- [ ] Vercel 環境変数 設定:
  - 名前:`INTAKE_CRON_SECRET`
  - 値:上記 で 生成 した hex
  - 適用:Production のみ
- [ ] Vercel ダッシュボード → Cron Jobs で 各 cron に Authorization ヘッダ
      `Bearer <INTAKE_CRON_SECRET>` を 設定(または vercel.json 経由で 自動)
- [ ] 動作確認:Vercel ダッシュボード → Cron Jobs → Last invocation success

---

## 6. ⚠️ OG 画像 制作 + 配置(デザイン作業)

### 既存メタ

`app/layout.tsx` で OG 設定済:

```ts
openGraph: {
  type: "website",
  locale: "ja_JP",
  url: siteUrl,
  siteName: "Maira",
  title: "Maira - AI 採用エージェント",
  description: "キャリア棚卸し、診断、書類作成、...",
}
```

ただし `images:` が 未設定。OG 画像が SNS シェア時 に 表示されない。

### 残タスク

- [ ] 1200 × 630 px の OG 画像 を 制作
  - Maira ロゴ + キャッチコピー「あなただけの AI 採用エージェント」等
  - 既存 ブランドカラー(オレンジ / 黄) を 使用
- [ ] `public/og.png` に 配置
- [ ] `app/layout.tsx` の `openGraph` に 以下を 追加:

```ts
openGraph: {
  ...既存,
  images: [
    {
      url: "/og.png",
      width: 1200,
      height: 630,
      alt: "Maira - AI 採用エージェント",
    },
  ],
},
twitter: {
  ...既存,
  images: ["/og.png"],
},
```

- [ ] 動作確認:Twitter Card Validator(https://cards-dev.twitter.com/validator)
- [ ] LINE / Facebook で シェア して 表示確認

---

## 7. ⚠️ モバイル UI 視覚的調整(次回 個別 範囲指定)

工数 2-4h と 見積 もり済 だが、 範囲が 広い ため 個別 ページ 指定 で 次回 着手。
具体的に「○○ ページが モバイルで 崩れて いる」と あれば その場で 修正。

### 確認推奨 画面(優先順)

- 求職者 ダッシュボード `/app`
- 求人 詳細 `/app/jobs/[id]`
- エージェント クライアント詳細 `/agency/clients/[id]`
- 新規求人 登録フォーム `/agency/jobs/new`
- ログイン / 新規登録 画面

---

## 環境変数 まとめ(Vercel Production)

以下を Vercel ダッシュボード で 設定 する 必要 あり:

```env
# Sentry
NEXT_PUBLIC_SENTRY_DSN=...
SENTRY_ORG=...
SENTRY_PROJECT=maira-prod
SENTRY_AUTH_TOKEN=...

# Cron
INTAKE_CRON_SECRET=<openssl rand -hex 32 で 生成>

# (既存) — 既に 設定済 の はず
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
FIELD_ENCRYPTION_KEYS=...
FIELD_ENCRYPTION_CURRENT_VERSION=v1
RESEND_API_KEY=...
EMAIL_FROM=...
NEXT_PUBLIC_SITE_URL=https://app.maira.pro
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...
ZOOM_WEBHOOK_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
OAUTH_STATE_SECRET=...
CHROMIUM_REMOTE_EXEC_PATH=...
```
