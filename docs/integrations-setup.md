# 外部連携セットアップガイド

「会議録音 自動連携」アドオン用の外部サービス設定手順。Zoom / Google / Stripe を順番に登録する。

すべて未設定でもアプリは動作する(該当連携機能だけ「準備中」表示になる)。本ガイドの作業は本番デプロイ前にまとめて行えば OK。

---

## 共通:OAuth state secret

任意の長いランダム文字列を生成して `OAUTH_STATE_SECRET` に入れる。state パラメータの HMAC 署名鍵として使う。

```bash
openssl rand -hex 32
```

---

## Zoom

「Zoom Cloud Recording 完了」イベントを受けて、録画を自動で取り込む。

### 1. Zoom Marketplace で App を作成

- URL: <https://marketplace.zoom.us/develop/create>
- App 種別:**User-managed OAuth App**
- Scopes:`cloud_recording:read`, `user:read`
- Redirect URL:`{SITE_URL}/api/integrations/zoom/callback`

### 2. Event Subscription を有効化

- Event types に **Recording > All Recordings have completed** を追加
- Notification endpoint URL:`{SITE_URL}/api/webhooks/zoom/recording`
- Secret Token を控える(後の `ZOOM_WEBHOOK_SECRET`)
- Endpoint URL Validation は自動で完了する(本ハンドラが challenge に応答する)

### 3. 環境変数

```bash
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...
ZOOM_WEBHOOK_SECRET=...
```

---

## Google(Sign in + Calendar + Drive Meet 録画取込)

Myaira は Google を「ログイン手段 + カレンダー連携 + Meet 録画取込」の 3 役で使う。
全部 1 つの OAuth アプリ + 1 回の同意で完結する。

### 1. Google Cloud Console で OAuth クライアント作成

- URL: <https://console.cloud.google.com/apis/credentials>
- アプリ種別:**Web application**
- Authorized JavaScript origins:`{SITE_URL}`
- Authorized redirect URIs(**3 つ登録**):
  - `{SITE_URL}/auth/callback` ← Sign in with Google + 設定画面の linkIdentity 用
  - `{SITE_URL}/api/integrations/google/callback` ← 旧フロー互換(段階的廃止予定)
  - **Supabase Auth 用**:`https://<your-project-ref>.supabase.co/auth/v1/callback`
    (Supabase Dashboard の Google プロバイダ画面に表示されるその URL を貼る)

### 2. API を有効化

API ライブラリで以下を「有効化」する:

- Google Drive API
- Google Calendar API
- People API(Sign in with Google で profile を取るのに使用)

### 3. OAuth 同意画面のスコープ申請

同意画面 → 「スコープを追加」で以下を申請する。

- `openid`, `email`, `profile`(基本)
- `https://www.googleapis.com/auth/calendar.events`(Myaira がカレンダーイベントを管理)
- `https://www.googleapis.com/auth/drive.readonly`(Meet 録画ファイルの読み取り)

初期は「テスト」モードのままで内部ユーザだけ通せばよい。本番公開時に審査申請。

#### 3.1 本番公開時の審査申請チェックリスト

Google OAuth の 「本番 公開」 は Google の 手動 レビュー が 必要 で、 数 日 〜 数 週間 かかる。 早め に 準備 する:

- [ ] **プライバシー ポリシー**: 公開 URL が 必要。 スコープ 用途 (calendar / drive) を 明記
- [ ] **利用 規約**: 公開 URL
- [ ] **ホーム ページ URL**: `https://maira.pro` 等 の 独自 ドメイン (Vercel の \*.vercel.app では 通り にくい)
- [ ] **アプリ アイコン**: 120x120 px 以上 の PNG (背景 透過 推奨)
- [ ] **スコープ 説明**: 各 センシティブ スコープ に つき 「何 を 保存 し、 何 を し ない か」 を 日本語 + 英語 で 200 字 程度
- [ ] **デモ 動画** (drive.readonly を 申請 する 場合): 実際 の Meet 録画 取り込み フロー を 3-5 分 で 撮影
- [ ] **セキュリティ アセスメント**: drive.readonly を 申請 する と CASA (Cloud Application Security Assessment) を 求め られる ケース あり (別 途 費用 発生)

**審査 で 詰まる 典型 例**:

- スコープ 説明 が 「Google Calendar API を 使用 します」 だけ → 用途 が 具体 的 で ない と 拒否
- プライバシー ポリシー が 更新 されて い ない → 該当 スコープ の 記述 が 無い と 差 戻し
- redirect URI が Console と ポリシー で 食い違う → 一致 させる

**拒否 された 場合 の 再申請**: Google Cloud サポート チケット で 差分 を 送る。 テスト モード の 100 人 制限 で 一 定 期間 は 運用 できる。

### 4. 環境変数

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### 5. Supabase Dashboard で Google プロバイダを有効化

Myaira の「Google でログイン」を動かすには、**Supabase Dashboard 側の設定が必須**。

1. <https://supabase.com/dashboard/project/_/auth/providers> を開く
2. **Google** を見つけて「Enabled」を ON
3. **Client ID** / **Client Secret** に上記 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を貼る
4. 上に表示される `Callback URL (for OAuth)` を**コピーして、手順 1 の Google Cloud Console の Redirect URIs にも追加**(双方向で必要)

### 6. Identity Linking(同じメールなら同じ Myaira ユーザーにする)

メール/パスワード登録済のユーザーが Google でログインしたとき、**同じ Myaira ユーザー
として扱う**ためには Supabase の「Identity Linking」設定が必要。

1. <https://supabase.com/dashboard/project/_/auth/settings> を開く
2. 「**Allow same email to be associated with multiple identities**」 を ON
   (もしくは「Auto-link identities with same email」相当の項目)

この設定を ON にしないと、メール/パスワード登録済の人が Google でログインしたとき
「**Email already in use**」エラーになる。

### 7. 動作確認

- `/login` → 「Google でログイン」が表示される
- クリック → 同意画面 → `/app` に遷移できる
- `/app/settings/integrations` で「接続中」+「✓ Google カレンダー」「✓ Google Meet 録画の自動取込」が表示される
- 既存メール/パスワード登録ユーザは設定画面の「Google アカウントを連携する」ボタンで同一ユーザーに統合される

---

## Stripe(アドオン 課金)

「会議 録音 自動 連携」 アドオン の 月額 課金 を Stripe Subscription で 管理 する。

### 1. Stripe で 商品 / 価格 を 作成

- 商品:`Meeting Recording Auto Integration`
- 価格:月額 (任意 の 金額)
- 価格 ID (`price_xxx`) を 控える

### 2. Webhook を 登録

- URL: `{SITE_URL}/api/webhooks/stripe`
- 送信 イベント:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
  - `invoice.paid`
  - `invoice.payment_failed`
- Signing secret (`whsec_xxx`) を 控える

### 3. Checkout 作成 時 の メタデータ

Checkout Session 作成 時 に **`metadata.user_id` を 必ず 付与** する (Webhook 側 で これ を subscription_addons.user_id に マップ する ため)。

### 4. 環境 変数

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MEETING_RECORDING_AUTO=price_...
```

---

## Stripe(組織 課金 プラン - 追加)

Standard / Extra Seat / AI Boost を Stripe Subscription で 管理 する。 「会議 録音」 アドオン と 同一 Webhook (`/api/webhooks/stripe`) を 共有 する ため、 上記 の Webhook 設定 は そのまま 流用。 追加 で 6 本 の Price ID を セット する。

### 1. Stripe Dashboard で 3 商品 を 作成

Products → New Product で 以下 3 プロダクト を 作成:

| Product           | 用途                     | 課金 単位                          |
| ----------------- | ------------------------ | ---------------------------------- |
| Myaira Standard   | Base プラン (3 席 込み)  | 月額 + 年額 の 2 Price             |
| Myaira Extra Seat | Base 超過 分 の 追加 席  | 月額 + 年額 の 2 Price (1 席 単価) |
| Myaira AI Boost   | Standard Pro 化 アドオン | 月額 + 年額 の 2 Price             |

各 プロダクト に つき **月額 (JPY) + 年額 (JPY) の 2 Price** を 作成 する。 合計 6 Price ID。

推奨 metadata (任意 だが 監視 で 有用):

- Product に `scope=organization`
- Extra Seat に `unit=seat`
- AI Boost に `unit=addon`

### 2. Price ID を 環境 変数 に 入れる

```bash
STRIPE_PRICE_STANDARD_BASE_MONTHLY=price_...
STRIPE_PRICE_STANDARD_BASE_YEARLY=price_...
STRIPE_PRICE_EXTRA_SEAT_MONTHLY=price_...
STRIPE_PRICE_EXTRA_SEAT_YEARLY=price_...
STRIPE_PRICE_AI_BOOST_MONTHLY=price_...
STRIPE_PRICE_AI_BOOST_YEARLY=price_...
```

**6 本 のうち 1 本 でも 未設定** だと `app/api/webhooks/stripe/route.ts` が `org_prices_missing` で 503 を 返し、 課金 経路 が 全て 停止 する。

### 3. Checkout Session の metadata 契約

`lib/integrations/stripe.ts` の `createOrgCheckoutSession()` は 以下 を 必ず セット する (実装 済):

- `subscription_data.metadata.scope = "organization"`
- `subscription_data.metadata.organization_id = <UUID>`
- `client_reference_id = <organization_id>`

Webhook 側 で `subscription.metadata.scope === "organization"` を 見て 「組織 経路」 か 「個人 アドオン 経路」 を 分岐 する。 **invoice.metadata に は Stripe が subscription.metadata を コピー しない** ため、 invoice.paid / invoice.payment_failed ハンドラ は `invoice.subscription` から `organization_plans` を 逆引き して orgId を 決定 する (Batch 2 M2 修正)。

### 4. 本番 Live smoke test (deploy 前 の 必須 確認)

以下 の 5 経路 を Live キー で 通す:

- [ ] Standard 月額 チェックアウト → subscription.created → organization_plans が active に なる
- [ ] Standard 年額 チェックアウト → 同上、 cycle=yearly
- [ ] Extra Seat 追加 (POST `/api/agency/billing/seats`) → subscription.updated → seat_count 更新
- [ ] AI Boost 追加 (POST `/api/agency/billing/boost`) → tier=standard_pro に 反映
- [ ] AI Boost 解除 (DELETE `/api/agency/billing/boost`) → tier=standard に 戻る

**確認 ポイント**:

- Stripe Dashboard → Events で 全 event が 200 で 完了 して いる
- Supabase (prod) の `stripe_events` テーブル に event.id が 記録 され、 重複 なし
- `organization_plans.last_stripe_event_id` / `last_synced_at` が 更新 されて いる
- `apply_stripe_subscription_sync` RPC が SELECT FOR UPDATE + UPSERT で 実行 されて いる (Batch 2 H2 修正)

### 5. 免除 組織 (社内 テスト / パートナー) の 扱い

`organization_plans.is_billing_exempt=true` の 組織 は Webhook が 到着 して も plan 列 を 一切 触ら ない (`handleSubscriptionSync` / `handleCheckoutCompleted` / invoice ハンドラ で 早期 return)。 社内 動作 確認 用 の 組織 は これ で 保護。

---

## Vercel Cron(背景ジョブ)

`vercel.json` の `crons` で `/api/internal/career-intake/pickup` を 5 分おきに叩く設定済み。Vercel 側で自動的に `Authorization: Bearer {VERCEL_CRON_SECRET}` を付与してくれる。

エンドポイント側は `X-Cron-Secret` ヘッダで `INTAKE_CRON_SECRET` を検証する設計。Vercel Cron からは Authorization ヘッダで来るので、必要なら受信側で両方受け付けるよう調整する。

---

## 接続後の動作確認

1. `/app/settings/integrations` を開く
2. 「会議録音 自動連携」アドオンが contracted 表示か(or テスト用に手動で `subscription_addons` に行を INSERT)
3. 「Zoom に接続 / Google に接続」ボタンが活性化していることを確認
4. ボタン → 認可 → 自動で `/app/settings/integrations?connected=zoom`(または google)に戻ってくる
5. 「接続中」バッジ表示 + 切断ボタンが出る
