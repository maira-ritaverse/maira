# エージェント企業 Pro プラン:設計・実装タスク

ステータス:**設計のみ(未実装)**
最終更新:2026-06-29

## 確定 した 運用方針(2026-06-29)

- **月額価格**:後日決定(マーケ判断 / 競合分析の あと)
- **切替方式**:**手動 切替**(Maira admin が 申込内容を 確認してから 切替)
- **Stripe 連携**:**当面 見送り**(Phase 3 として 残すが MVP では 不要)
- **MVP スコープ**:申込導線(エージェント側)+ 手動切替 UI(admin 側)+ 機能解禁ロジック

---

## 目的

エージェント企業向けに **Pro プラン** を 提供し、以下を 解禁する:

1. **Zoom 録音 / 録画 → AI 要約 → 履歴書・職務経歴書 自動生成**
2. **AI 月次利用上限の 引き上げ**(現在 既定 500 → Pro 2,000-5,000 程度)
3. その他 Pro 限定機能(将来追加)

申込導線:エージェント管理者(`admin` role)のみが 申込フォームから 運営に 問合せ。

---

## 想定 価格と コスト感(参考値)

`docs/perf-audit.md` などを 参考に、エージェント側 AI コスト 試算:

| プラン     | 月次総量上限   | 想定 月次 コスト(最大)     | 月額                                                      |
| ---------- | -------------- | -------------------------- | --------------------------------------------------------- |
| Free(既定) | 500 回         | 約 $5-15 (¥750-2,250)      | ¥0                                                        |
| Pro        | 2,000-5,000 回 | 約 $25-100 (¥3,750-15,000) | **後日決定**(下記コストを 元に マーケ判断、運用後 仮設定) |

価格設定の 参考:Pro は **Zoom 録音解禁 + AI 上限引上** の セット 価値 で 設定。

- Whisper(録音文字起こし)コスト:約 $0.36 / 時間
- 月 30 時間 録音解析 想定:約 $10.8
- AI 要約 / CV 生成(Claude Sonnet):約 $0.10 / 件 × 50件 = $5

---

## 機能仕様

### A. 申込導線(エージェント側)

- 設置場所:`/agency` ダッシュボード上部 or `/agency/settings`
- 表示条件:role = `admin` のみ(advisor には 出さない)
- 既に Pro 契約中なら 「Pro プラン契約中」バッジ表示、申込フォームは 非表示

#### A-1. Pro プラン 紹介カード(常時表示)

```
┌──────────────────────────────────────────┐
│ 🚀 Pro プランで AI 機能を フル活用      │
│                                          │
│ ・Zoom 録音から AI が 履歴書 / 職務経歴書 │
│   を 自動生成                             │
│ ・月次 AI 利用上限 が 大幅 アップ        │
│ ・面談記録の AI 要約                     │
│                                          │
│ 月額 ¥XX,XXX (税込)                       │
│  [Pro プランに申し込む →]                 │
└──────────────────────────────────────────┘
```

#### A-2. 申込フォーム(モーダル or 別ページ)

入力項目:

- 会社名(profile から自動取得)
- 担当者名 + メール(profile から自動取得)
- 想定 利用人数(自由入力)
- 要望 / 質問(任意)

送信先:`contact_messages` テーブル(運営者が `/admin/contacts` で確認)

- `category` カラム を 拡張:`"pro_plan_inquiry"` を 追加
- `metadata` に `{ organizationId, intendedMembers }` を 格納

### B. プラン状態管理

#### B-1. 新カラム `organizations.plan`(enum)

```sql
alter type plan_type add value if not exists 'agency_pro';
-- 既存 enum: 'free', 'standard', 'pro' は 求職者側 plan_type と 共有
-- 競合避けるため 新規 enum を 検討:
create type organization_plan_type as enum ('free', 'pro');

alter table public.organizations
  add column plan organization_plan_type not null default 'free',
  add column plan_started_at timestamptz,
  add column plan_expires_at timestamptz;
```

#### B-2. 運営者の プラン切替操作

- `/admin/organizations/[id]` に「プラン」セクション 追加
- ドロップダウン:Free / Pro 切替 + 開始日 / 期限日 設定
- Pro 切替時に **AI 月次上限 を 自動引上** (platform_ai_total_quotas に 2000-5000 で upsert)
- 期限切れ 自動 Free 戻し は Cron で 検知(`/api/internal/plans/expire-check`)

### C. Pro 限定機能 解禁ロジック

| 機能                 | 解禁条件                     | 実装場所                                                    |
| -------------------- | ---------------------------- | ----------------------------------------------------------- |
| Zoom 録音 自動取込   | `organizations.plan = 'pro'` | `app/api/integrations/zoom/recording/import/route.ts`(新規) |
| 会議録音から CV 生成 | 同上                         | 既存 `lib/career-intake/process.ts` を 拡張                 |
| AI 上限 引上         | 同上                         | `platform_ai_total_quotas` の 自動 upsert                   |

実装ヘルパ:

```ts
// lib/organizations/plan.ts
export async function getOrganizationPlan(orgId: string): Promise<"free" | "pro">;
export async function requireProPlan(orgId: string): Promise<{ ok: boolean }>;
```

---

## 実装フェーズ

### Phase 1: 申込導線のみ(運営側で 手動 プラン切替)

- [ ] DB:`organizations.plan` カラム 追加(マイグレーション)
- [ ] `/admin/organizations/[id]` に プラン切替 UI
- [ ] エージェント側 ダッシュボード に Pro プラン 紹介カード + 申込フォーム
- [ ] `/api/agency/pro-plan-inquiry`(POST):contact_messages に 保存 + 運営者に 通知メール
- [ ] `/admin/contacts` で `pro_plan_inquiry` を 識別表示

### Phase 2: Pro 機能 解禁 + 自動上限引上

- [ ] `requireProPlan()` ヘルパ
- [ ] Zoom 録音 自動取込 endpoint(既存 zoom/recording webhook を Pro 限定に)
- [ ] AI 上限 自動 upsert(Free → Pro 切替時 / 解約時)

### Phase 3: 決済連携(Stripe)— **当面 見送り**

> 2026-06-29 運用方針:手動切替で MVP を 回す。Stripe 導入は 顧客数が 増えて 手動運用が
> 限界に なってから 検討する。それまでは Phase 1 (申込導線 + 手動切替) のみで 運用。

- [ ] Stripe Checkout で Pro 月額決済
- [ ] webhook で `organizations.plan_started_at / expires_at` を 自動更新
- [ ] 失敗 / 解約 時の 自動 Free 戻し

---

## セキュリティ / 運用

- `organizations.plan` は **service_role のみ書込可** (Stripe webhook 経由)
- エージェント admin は 自分の 組織の plan を **読取のみ**
- audit_logs に `action="organization_plan_changed"` を 記録

---

## 関連ファイル(将来 実装時の 参照先)

- `lib/features/ai-usage.ts`:`PLATFORM_AI_TOTAL_FREE_MONTHLY`
- `app/(admin)/admin/organizations/[id]/platform-ai-quotas-section.tsx`:既存 admin AI 上限編集
- `lib/features/entitlements.ts`:既存 アドオン(求職者向け)— Pro プラン と 共存する 仕組みを 検討
- `app/api/contact-messages/route.ts`:既存 問合せ 受付経路

---

## 未決事項(着手時に 要確認)

1. ~~月額 価格~~ → **後日決定**(2026-06-29 確認済)
2. Pro 切替 タイミング:即時 / 翌月 から
3. ~~Free → Pro 即解禁 vs 手動承認後 解禁~~ → **手動承認後 解禁**(2026-06-29 確認済)
4. ~~Stripe 導入 タイミング~~ → **当面 見送り**(2026-06-29 確認済)
