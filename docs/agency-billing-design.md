# エージェント企業 課金 設計(確定 仕様)

ステータス:**仕様確定、 Stripe 契約 待ち**
最終更新:2026-06-20(改定確定)

本ドキュメント は `docs/agency-pro-plan-design.md`(設計ドラフト)を 置き換える、
**Stripe 契約 後 そのまま 実装着手 できる レベルの 確定 仕様書** です。

---

## 1. 料金 体系(確定)

### 1-1. Standard(必須 = 基本契約)

| 項目        | 内容          | 価格(税込)       |
| ----------- | ------------- | ---------------- |
| 基本料金    | 1〜3 人 まで  | **¥25,000 / 月** |
| 4 人目以降  | 1 人あたり    | **+¥3,980 / 月** |
| AI 利用上限 | 組織横断 月次 | **500 回 / 月**  |

### 1-2. アップグレード(3 択、**排他**)

下記 3 つ は **互いに 排他**。 顧客は 0 個 or 1 個 を 選ぶ。
「Pro + 録音 を 別々に 」は 不可 → Premium に 誘導。

| プラン                | 追加内容                                                                  | 価格(税込)        |
| --------------------- | ------------------------------------------------------------------------- | ----------------- |
| **+ 録音 オプション** | Zoom / Meet 録音 機能(月 50 件、 1 件 90 分まで、 90 分 超過 = 2 件 換算) | **+¥10,000 / 月** |
| **+ Pro**             | AI +500 回(合計 月 1,000 回)、 録音 含まず                                | **+¥4,200 / 月**  |
| **+ Premium**         | AI +500 回 + 録音 機能 セット(別々購入 ¥14,200 → 15% OFF)                 | **+¥12,000 / 月** |

### 1-3. 年払い

月額合計 × 12 → **10% OFF**

### 1-4. 料金例(5 人 エージェント、 フル装備)

| 区分            | 月額                              |
| --------------- | --------------------------------- |
| Standard        | ¥25,000 + ¥3,980 × 2 = ¥32,960    |
| + Premium       | + ¥12,000                         |
| **月額 合計**   | **¥44,960**                       |
| 年払い(10% OFF) | **¥485,568 / 年**(月換算 ¥40,464) |

---

## 2. 利益 試算

5 人 / Standard + Premium の 月次:

| 項目                                               | 金額              |
| -------------------------------------------------- | ----------------- |
| 売上                                               | ¥44,960           |
| AI コスト(1,000 回 × $0.0135 ≒ ¥2,025)             | ¥2,025            |
| 録音 50 件(Whisper $0.36/h + Claude)× 50 ÷ 2 ≒ $30 | ¥4,500            |
| インフラ 按分(Vercel + Supabase)                   | ¥1,200            |
| **粗利 / 率**                                      | **¥37,235 / 83%** |

→ 全プラン 83-92% 粗利 で 健全。

---

## 3. 無料期間 1 ヶ月(確定)

### フロー

```
Day 0  : 企業 アカウント 発行(クレカ 必須登録)
         ↓
       無料 トライアル 開始(30 日間)
       ・Standard 全機能 + 「録音 オプション 体験」付与
         (録音 50 件 / Pro / Premium 全部 試せる)
         ↓
Day 23 : メール「無料期間 残 7 日」+「アップグレード継続?」確認
         ・顧客が UI で 継続 する アップグレード を 選択(または 「Standard のみ」)
         ・選択 し ないと Day 30 で 全アップグレード 自動停止
         ↓
Day 29 : メール「明日から 課金開始」最終通知
         ↓
Day 30 : 無料期間終了 → 自動 課金 開始
         ・Standard 自動 課金
         ・選択 した アップグレード が あれば それも 課金
```

### 重要 ルール

- **クレカ 登録 は 新規登録 時 に 必須**(Stripe `setup_intent` で 事前登録)
- **無料期間中 に アップグレード を 「選択」しないと 終了後 Standard のみ に なる**
- **トライアル中 に 解約 した 場合 は 課金されない**
- **トライアル中 の AI / 録音 利用 が 上限 超過 した 場合**:警告のみ(無料期間 内 は ブロック しない)

---

## 4. ビジネス ルール(細部)

### 4-1. 排他制御

- 「録音 オプション」「Pro」「Premium」の **同時加入は 不可**
- 既存契約 中 に 別プラン へ 切替 = Stripe Subscription Item 入替(プロレート 計算)
- UI で 「ご希望の 機能 を 一括 すべて 含む プラン は Premium です」誘導

### 4-2. 録音 件数 カウント

- 1 録音 ≤ 90 分 = **1 件**
- 1 録音 > 90 分 = **2 件**(180 分 超 = 3 件 と は しない、 1 件 = 90 分 単位 で 切上)
- 月次 50 件 を 超過 → エラー(翌月 まで 待つ、 または Pro/Premium へ アップグレード 誘導)
- リセット = **JST 月初 0:00**

### 4-3. AI 利用 上限

- 既存 500 回 / 月 制限 を そのまま 適用(`PLATFORM_AI_TOTAL_FREE_MONTHLY = 500`)
- Pro / Premium 契約中 は +500 = 1,000 回
- 上限 は organization_plans / subscription_addons から 動的計算
- 既存 `platform_ai_total_quotas` テーブル は Maira admin の 上書き用 として 維持

### 4-4. 4 人目以降 課金

- 月初時点 の `organization_members` 件数 ベース で 計算
- 月中 追加 → 翌月から 課金(プロレート しない、 シンプル運用)
- 月中 削除 → 翌月 から 減額

### 4-5. 年払い 切替

- 月払い → 年払い:残り 月 を プロレート 返金 + 年払い 即時 課金
- 年払い → 月払い:年払い 残り 期間 終了後 月払い 開始

---

## 5. データベース 設計

### 5-1. 新規 テーブル `organization_plans`

```sql
CREATE TYPE organization_plan_tier AS ENUM (
  'standard',         -- 基本のみ (¥25,000 + ¥3,980/4人目以降)
  'standard_rec',     -- + 録音 オプション
  'standard_pro',     -- + Pro (AI +500)
  'standard_premium'  -- + Premium (録音 + Pro)
);

CREATE TYPE billing_cycle AS ENUM ('monthly', 'yearly');

CREATE TABLE organization_plans (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  tier organization_plan_tier NOT NULL DEFAULT 'standard',
  cycle billing_cycle NOT NULL DEFAULT 'monthly',

  -- 無料期間
  trial_started_at timestamptz,
  trial_ends_at timestamptz,

  -- 課金状態
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billed_at timestamptz,

  -- Stripe
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,

  -- 状態
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  canceled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 5-2. 録音 件数 カウント

`ai_usage_events` に 新 kind 追加(既存 infra 流用):

```ts
// lib/features/ai-usage.ts
| "agency_recording_processed"  // 録音 1 件 = 1 カウント
                                // 90 分 超過時は 2 件 INSERT する
```

### 5-3. Maira admin の 強制 上書き

既存 `platform_ai_total_quotas` を 維持 → 運営者が 個別 org の 上限 を 上書き 可能。

---

## 6. Stripe Product / Price 設計

### 6-1. Product 一覧

| Product 名                | type                              | 用途                        |
| ------------------------- | --------------------------------- | --------------------------- |
| `agency_base`             | Subscription                      | 基本料金 ¥25,000 / 月(税込) |
| `agency_per_seat`         | Subscription(metered or licensed) | 4 人目以降 ¥3,980 / 月 / 人 |
| `agency_recording_option` | Subscription                      | 録音 +¥10,000 / 月          |
| `agency_pro_upgrade`      | Subscription                      | Pro +¥4,200 / 月            |
| `agency_premium_upgrade`  | Subscription                      | Premium +¥12,000 / 月       |

### 6-2. Price 一覧(月次 + 年次)

各 Product に Price を 2 つ ずつ(月払い / 年払い 10% OFF):

```
agency_base:
  - price_base_monthly_jpy_25000 (¥25,000)
  - price_base_yearly_jpy_270000 (¥270,000 = ¥25,000 × 12 × 0.9)

agency_per_seat:
  - price_seat_monthly_jpy_3980 (¥3,980)
  - price_seat_yearly_jpy_42984 (¥42,984 = ¥3,980 × 12 × 0.9)

agency_recording_option:
  - price_rec_monthly_jpy_10000 (¥10,000)
  - price_rec_yearly_jpy_108000 (¥108,000)

agency_pro_upgrade:
  - price_pro_monthly_jpy_4200 (¥4,200)
  - price_pro_yearly_jpy_45360 (¥45,360)

agency_premium_upgrade:
  - price_premium_monthly_jpy_12000 (¥12,000)
  - price_premium_yearly_jpy_129600 (¥129,600)
```

### 6-3. Subscription 構成

1 つの Stripe Subscription に 複数 SubscriptionItem を 持つ:

```
Subscription
  ├─ Item: agency_base (1 quantity)
  ├─ Item: agency_per_seat (quantity = max(0, agent_count - 3))
  └─ Item: アップグレード(0 or 1 個 / 排他)
       ・agency_recording_option
       ・agency_pro_upgrade
       ・agency_premium_upgrade
```

quantity を 月初 cron で 更新(`organization_members` 件数 反映)。

---

## 7. API / Webhook 設計

### 7-1. 顧客 操作 API

| エンドポイント                          | 役割                              |
| --------------------------------------- | --------------------------------- |
| `POST /api/agency/billing/setup-intent` | クレカ事前登録(新規登録時)        |
| `GET /api/agency/billing/subscription`  | 現プラン状態 取得                 |
| `POST /api/agency/billing/change-tier`  | プラン変更(排他制御)              |
| `POST /api/agency/billing/change-cycle` | 月払い ↔ 年払い 切替              |
| `POST /api/agency/billing/cancel`       | 解約予約(期末解約)                |
| `POST /api/agency/billing/portal`       | Stripe Customer Portal リンク発行 |

### 7-2. Webhook(`/api/webhooks/stripe` 既存 拡張)

| イベント                        | 処理                                   |
| ------------------------------- | -------------------------------------- |
| `customer.subscription.created` | organization_plans に INSERT or UPDATE |
| `customer.subscription.updated` | tier / status / period 同期            |
| `customer.subscription.deleted` | status='canceled'                      |
| `invoice.payment_succeeded`     | period 更新、ログ記録                  |
| `invoice.payment_failed`        | status='past_due'、admin に Slack 通知 |
| `charge.refunded`               | refund 記録、必要なら status 変更      |

### 7-3. 内部 Cron(既存 vercel.json 拡張)

| Path                                        | 頻度       | 役割                                                |
| ------------------------------------------- | ---------- | --------------------------------------------------- |
| `/api/internal/billing/seat-sync`           | 月初 0:00  | 全 org の agent 数 → SubscriptionItem quantity 同期 |
| `/api/internal/billing/trial-notifications` | 1 時間ごと | trial_ends_at 7 日前 / 1 日前 メール                |
| `/api/internal/billing/trial-expire`        | 30 分ごと  | trial 終了 org の 課金切替                          |

---

## 8. UI 設計

### 8-1. 新規登録 フロー(エージェント企業)

```
[1] 企業名 + 連絡先 入力
[2] クレジットカード 登録(Stripe Elements)
[3] 利用規約 + 課金規約 同意
[4] 「無料 トライアル を 開始」
    → organization 作成 + Stripe Customer 作成 + setup_intent 確定
[5] /agency にリダイレクト + 「トライアル 開始」バナー表示
```

### 8-2. /agency/settings/billing(新設)

- **現プラン**:Standard / 録音 / Pro / Premium のいずれか
- **状態**:trialing / active / past_due / canceled
- **次回 課金日 / 金額**
- **エージェント人数 と 料金内訳**
- **アップグレード ボタン**(排他、 確認モーダル付き)
- **月払い ↔ 年払い 切替 ボタン**
- **Customer Portal ボタン**(領収書 / カード変更)
- **解約ボタン**(期末解約)

### 8-3. /admin/payments 拡張

既存 `/admin/payments` の Pro プラン セクション を 実装。
組織 Plan + Subscription 状態 を 表示。 ¥ ベース 売上 集計。

### 8-4. 無料期間中 の UI 表示

- ヘッダー / ダッシュボード に 「無料期間 残 X 日」バナー
- 録音 / Pro / Premium 機能 を 「試しに 使ってみる」ボタン で 切替 可能
- 残 7 日 で 「アップグレード継続 する?」モーダル(Day 23 メールから 誘導)

---

## 9. 実装 フェーズ(Stripe 契約後)

### Phase 1:基盤(2-3 日)

- [ ] マイグレーション(organization_plans + 関連 RPC)
- [ ] Stripe Product / Price 作成(10 個、 ダッシュボード or API)
- [ ] `lib/billing/agency.ts`(プラン管理 ヘルパー)
- [ ] `/api/agency/billing/setup-intent` + 新規登録 フロー
- [ ] Webhook 拡張(`customer.subscription.*`)

### Phase 2:UI + 解約 / 切替(2 日)

- [ ] `/agency/settings/billing` ページ
- [ ] プラン変更 / 解約 UI
- [ ] 月払い ↔ 年払い 切替
- [ ] Customer Portal 連携

### Phase 3:Cron + 通知(1 日)

- [ ] seat-sync cron
- [ ] trial-notifications cron
- [ ] trial-expire cron
- [ ] メール文面(Resend)

### Phase 4:制限 + 監視(1 日)

- [ ] 録音 件数 制限(`agency_recording_processed` カウント)
- [ ] 90 分 超過 = 2 件 換算 ロジック
- [ ] `/admin/payments` の Pro プラン セクション 実装
- [ ] Sentry 統合

**合計 工数:約 6-7 日**

---

## 10. マーケ メッセージ(参考、 LP / 募集メール 用)

```
Maira for Agency

[Standard]  ¥25,000 / 月
  3 人 まで、4 人目以降 +¥3,980 / 月
  AI 月 500 回 / 求人推薦 / クライアント管理

[+ 録音 オプション]  +¥10,000 / 月
  Zoom / Meet 録音 → AI 自動 履歴書生成
  月 50 件、 1 件 90 分まで(超過は 2 件 換算)

[+ Pro]  +¥4,200 / 月
  AI +500 回(月 1,000 回 利用)

[+ Premium]  +¥12,000 / 月
  Pro + 録音 セット
  別々購入 ¥14,200 → 15% OFF

・初月 無料(クレカ 必須登録)
・年払いで さらに 10% OFF
```

---

## 11. 未決 / 後日 確認 事項

1. **特商法 ページ** の 価格表記 更新(本仕様 で 上書き)
2. **法人銀行振込** 対応 する?(現状は クレカのみ。 大口顧客 要望 時 検討)
3. **Customer Portal カスタマイズ**(Stripe 標準 で 十分か 検証)
4. **解約理由 アンケート**(任意、 UX 改善 用)
5. **Webhook 失敗時 の 再送 設計**(Stripe 標準 3 回 + 手動 再送 で OK?)

---

## 12. 関連 ファイル / 既存 実装 ポインタ

着手 時の 参照先:

- `lib/features/ai-usage.ts`:`PLATFORM_AI_TOTAL_FREE_MONTHLY`(基本 500)
- `lib/features/entitlements.ts`:既存 アドオン(meeting_recording_auto 等)
- `app/api/webhooks/stripe/route.ts`:既存 Webhook(求職者 ブースト 対応 含む)
- `supabase/migrations/20260617000001_add_subscription_addons.sql`:既存 アドオン スキーマ
- `app/(admin)/admin/payments/`:既存 admin UI(Pro セクション ここに 実装)
- `docs/agency-pro-plan-design.md`:旧 設計 ドラフト(本ドキュメントで 置き換え)
