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

Maira は Google を「ログイン手段 + カレンダー連携 + Meet 録画取込」の 3 役で使う。
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
- `https://www.googleapis.com/auth/calendar.events`(Maira がカレンダーイベントを管理)
- `https://www.googleapis.com/auth/drive.readonly`(Meet 録画ファイルの読み取り)

初期は「テスト」モードのままで内部ユーザだけ通せばよい。本番公開時に審査申請。

### 4. 環境変数

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### 5. Supabase Dashboard で Google プロバイダを有効化

Maira の「Google でログイン」を動かすには、**Supabase Dashboard 側の設定が必須**。

1. <https://supabase.com/dashboard/project/_/auth/providers> を開く
2. **Google** を見つけて「Enabled」を ON
3. **Client ID** / **Client Secret** に上記 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を貼る
4. 上に表示される `Callback URL (for OAuth)` を**コピーして、手順 1 の Google Cloud Console の Redirect URIs にも追加**(双方向で必要)

### 6. Identity Linking(同じメールなら同じ Maira ユーザーにする)

メール/パスワード登録済のユーザーが Google でログインしたとき、**同じ Maira ユーザー
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

## Stripe(アドオン課金)

「会議録音 自動連携」アドオンの月額課金を Stripe Subscription で管理する。

### 1. Stripe で商品 / 価格を作成

- 商品:`Meeting Recording Auto Integration`
- 価格:月額(任意の金額)
- 価格 ID(`price_xxx`)を控える

### 2. Webhook を登録

- URL: `{SITE_URL}/api/webhooks/stripe`
- 送信イベント:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Signing secret(`whsec_xxx`)を控える

### 3. Checkout 作成時のメタデータ

Checkout Session 作成時に **`metadata.user_id` を必ず付与**する(Webhook 側でこれを subscription_addons.user_id にマップするため)。

### 4. 環境変数

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MEETING_RECORDING_AUTO=price_...
```

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
