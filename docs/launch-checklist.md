# Myaira 本番ローンチ チェックリスト

最終更新:2026-06-15

本ドキュメントは、開発環境(maira-dev)から本番環境(maira-prod)に切り替えてサービスを公開するまでの手順 + 検証チェックリストです。
1 つずつ消し込みながら進めます。

---

## Phase 0:事前準備(コード以外)

- [ ] 屋号 / 運営会社情報の最終確認(プライバシーポリシー第 9 条、利用規約第 9 条)
- [ ] 特定商取引法ベースの表示ページ(必要なら `/legal` 等で別途用意)
- [ ] サポート問い合わせ窓口(メール or フォーム)を `/contact` に設定
- [ ] ドメイン:`NEXT_PUBLIC_SITE_URL` で使う本番 URL を確定

---

## Phase 1:Supabase 本番環境(maira-prod)準備

### マイグレーション適用

> **重要**:[CLAUDE.md](../CLAUDE.md) の方針により、明示的に指示があるまで本番 push は行いません。

- [ ] dev でリリース候補のマイグレーションをすべて確認(累計 37 件)
- [ ] `supabase projects list` で現在のリンク先が `maira-dev` であることを確認(誤実行防止)
- [ ] バックアップ:`maira-prod` の Supabase Dashboard で「Database Backups → Create backup」
- [ ] 本番リンク切替え:`supabase link --project-ref xxatkimjfiaidxfuglae`(maira-prod)
- [ ] **再確認**:`supabase projects list` で LINKED が maira-prod になったことを目視
- [ ] `supabase db push` を実行
- [ ] 完了後、dev に戻す:`supabase link --project-ref pfebbpgcufintmulhydg`

### Storage バケット作成

- [ ] `career-intake-audio` バケット(private)
- [ ] `resume-photos` バケット(private)
- [ ] RLS は migration で自動設定(`storage.objects` のポリシー)

### 環境変数(暗号化鍵 + サービス鍵)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxatkimjfiaidxfuglae.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# 暗号化(本番では別の鍵を生成すること)
FIELD_ENCRYPTION_KEYS={"v1":"<base64-32byte>"}
FIELD_ENCRYPTION_CURRENT_VERSION=v1

# AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...  # Whisper + gpt-image-1 用

# サイト URL
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

- [ ] `FIELD_ENCRYPTION_KEYS` を新規生成:`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`(dev とは別の鍵にする)
- [ ] `OPENAI_API_KEY` は Whisper(録音文字起こし)+ gpt-image-1(AI 写真)で共用
- [ ] **dev の鍵を本番に流用しない**(漏洩時の影響範囲を分離)

---

## Phase 2:外部連携(任意機能、必要な分だけ)

### Vercel Cron

- [x] `vercel.json` で 2 つの cron を定義済み(`/api/internal/career-intake/pickup` 5 分、`/api/internal/integrations/google-drive/poll` 15 分)
- [ ] Vercel ダッシュボードで cron secret を設定:`INTAKE_CRON_SECRET=<openssl rand -hex 32>`

### Stripe(アドオン課金)

- [ ] Stripe で商品「会議録音 自動連携」+ 月額 Price を作成
- [ ] Webhook 登録:URL = `{SITE_URL}/api/webhooks/stripe`、イベント = `customer.subscription.{created,updated,deleted}`
- [ ] Signing Secret を控えて env 設定:
  ```env
  STRIPE_SECRET_KEY=sk_live_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_PRICE_MEETING_RECORDING_AUTO=price_...
  ```
- [ ] Checkout 作成時に **`metadata.user_id` を必ず付与する**(webhook 側でこれをマップキーに使うため。コードでは自動で付くが手動再現時に注意)

### Zoom 連携(任意)

- [ ] Zoom Marketplace で User-managed OAuth App 登録
- [ ] Scope:`cloud_recording:read`, `user:read`
- [ ] Redirect URL:`{SITE_URL}/api/integrations/zoom/callback`
- [ ] Webhook URL:`{SITE_URL}/api/webhooks/zoom/recording`、Secret Token を取得
- [ ] env:
  ```env
  ZOOM_CLIENT_ID=...
  ZOOM_CLIENT_SECRET=...
  ZOOM_WEBHOOK_SECRET=...
  OAUTH_STATE_SECRET=<openssl rand -hex 32>
  ```

### Google Drive 連携(任意)

- [ ] Google Cloud Console で OAuth 2.0 クライアント作成
- [ ] Authorized redirect URI:`{SITE_URL}/api/integrations/google/callback`
- [ ] Google Drive API を有効化
- [ ] env:
  ```env
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  ```

### Resend(メール)

- [ ] Resend で API キー + 送信ドメイン認証
- [ ] env:
  ```env
  RESEND_API_KEY=re_...
  EMAIL_FROM=noreply@your-domain.example
  ```

### Slack(任意、招待ステータス + 求職者シグナル)

- [ ] 各エージェント組織の管理者が `/agency/settings` から Webhook URL を登録(本人作業)

詳細手順は [docs/integrations-setup.md](./integrations-setup.md) も参照。

---

## Phase 3:PWA / メタタグ / SEO

- [x] `public/manifest.webmanifest`(本セッションで作成)
- [x] `app/robots.ts` + `app/sitemap.ts`(本セッションで作成)
- [x] `app/layout.tsx` の lang="ja"、OG / Twitter / theme-color
- [ ] **アイコン 3 種類を `public/` に配置**(詳細:[docs/pwa-icon-setup.md](./pwa-icon-setup.md))
  - `public/icon-192.png`
  - `public/icon-512.png`
  - `public/icon-maskable-512.png`
- [ ] OG 画像(1200×630)を `public/og.png` に配置(任意、配置後は layout.tsx の openGraph.images に追加)

---

## Phase 4:Vercel デプロイ

- [ ] Vercel プロジェクト作成(GitHub リポジトリと連携)
- [ ] env を Vercel ダッシュボードに登録(Production / Preview / Development を区別)
- [ ] カスタムドメイン設定(DNS で Vercel の CNAME 設定 → SSL 自動)
- [ ] `NEXT_PUBLIC_SITE_URL` を実 URL に更新
- [ ] ビルド成功確認(初回デプロイ)

---

## Phase 5:ローンチ前 動作確認

### スモークテスト(自動)

- [ ] `pnpm vitest run` がパス(現状 1130 件)
- [ ] `pnpm tsc --noEmit` パス
- [ ] `pnpm eslint app/ lib/ components/` warning 0
- [ ] Playwright スモーク(任意、E2E*TEST*\* env 設定後)

### 手動確認(本番 URL)

- [ ] LP(/)が開く
- [ ] 新規ユーザ登録(個人 / エージェント両方)
- [ ] **暗号化検証**:Supabase Dashboard で `messages` / `career_profiles.encrypted_data` 等が暗号化されていることを目視
- [ ] AI ヒアリングで録音アップロード → Whisper + Claude → 履歴書下書きまで通る
- [ ] AI 写真:自撮りから Before/After 比較 → 保存
- [ ] AI 求人推薦が表示される(linked クライアント + open 求人がある場合)
- [ ] 興味あり / 応募を依頼 → 通知(in-app + email + Slack)
- [ ] エージェント側:クライアント詳細で AI 求人推薦カードが表示される
- [ ] 通知ベルが両側に表示される
- [ ] /app/agent-referrals で referrals が表示される
- [ ] 設定 → AI 利用状況(admin のみ)→ 月次推移グラフが描画される
- [ ] Stripe Checkout が起動する → 支払い → アドオン契約が反映される

---

## Phase 6:ローンチ後 監視

- [ ] Vercel Analytics(任意、追加 SDK 必要)
- [ ] Sentry(任意、追加 SDK 必要)
- [ ] **Anthropic ダッシュボードでトークン消費を毎日確認**(初週は毎日)
- [ ] **OpenAI ダッシュボードで Whisper + gpt-image-1 のリクエスト数確認**
- [ ] Supabase Dashboard の Database Insights で slow query 確認
- [ ] `/agency/settings/ai-usage`(admin)で organization 単位のコスト確認

---

## Phase 7:ローンチ後 想定インシデント対応

### AI クォータが想定外に爆発した場合

- `lib/features/ai-usage.ts` の定数を緊急調整 → Vercel 再デプロイで即時反映
- 該当 organization に手動で連絡

### Stripe Webhook が届かない / 失敗する場合

- Vercel ダッシュボード → Functions ログで `/api/webhooks/stripe` のエラー確認
- Stripe ダッシュボード → Webhooks → 配信履歴 + 手動再送

### Zoom / Google トークンが失効しっぱなしの場合

- 該当ユーザに「連携設定 → 解除 → 再接続」を案内
- pickup endpoint のログに refresh 失敗が連発していたら、Zoom / Google App 側の設定変更を疑う

---

## 巻末:現時点で未着手の launch optional 改善

| 項目                   | 優先度 | 工数         |
| ---------------------- | ------ | ------------ |
| Sentry 導入            | 高     | 1-2h         |
| Vercel Analytics 導入  | 中     | 30 min       |
| モバイル UI 視覚的調整 | 高     | 2-4h         |
| 多言語化(英語 LP)      | 低     | 半日         |
| OG 画像 + アイコン制作 | 高     | デザイン作業 |
