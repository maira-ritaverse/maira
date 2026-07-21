# LINE Lステップ相当マーケティングオートメーション 設計

- ステータス:設計確定、実装着手待ち
- 最終更新:2026-07-11
- 関連 ADR:[0007. LINE Lステップ相当の MA 拡張方針](./adr/0007-line-lstep-ma-flow.md)
- 関連ドキュメント:[LINE 公式アカウント連携設計](./line-integration-design.md)

Myaira の既存 LINE 連携 + MA 基盤の上に、「求職者への効果的なマーケティング」を実現する Lステップ相当の機能群(多段ステップ配信・条件分岐・動的セグメント・CV 追跡・行動スコア・キーワード自動応答・流入計測・フォーム・リッチメニュー自動化)を積み増す。

---

## 1. 前提

- 実装先:Myaira 本体(別プロジェクトではない)
- マルチテナント:既存 `organizations` × `line_channels`(1 組織 = 1 LINE 公式アカウント)を踏襲
- 対象:エージェント企業から求職者(LINE 友だち)へのマーケティング
- 認証:既存の Supabase Auth + `organization_members` を踏襲
- 送信 API:既存 `lib/line/api.ts` の push / multicast を流用、narrowcast は Phase 4
- Cron:既存 Vercel Cron を踏襲

---

## 2. 既存資産の再利用マップ

| 目的                    | 既存で使うもの                                | 追加/変更                                                                                |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 友だち管理              | `line_user_links`                             | 列追加(`engagement_score` / `entry_source_code`)                                         |
| タグ                    | `line_conversation_tag_assignments`           | そのまま(自動付与を Flow アクションで実施)                                               |
| メッセージテンプレ      | `ma_templates`(AES-256-GCM 暗号化 + 変数展開) | そのまま流用                                                                             |
| 短縮 URL / クリック計測 | `/r/{uuid}` + `ma_click_links`                | `ma_flow_step_id` 列追加                                                                 |
| 送信ログ                | `ma_send_logs`                                | `ma_flow_step_id` 列追加                                                                 |
| 送信 API                | `lib/line/api.ts` (push/multicast/reply)      | narrowcast を Phase 4 で追加                                                             |
| 一斉配信                | `line_broadcasts`                             | user 単位ログテーブル追加(Phase 3)                                                       |
| Welcome message         | `line_channels.welcome_message_encrypted`     | Phase 0 で「オンボーディング Flow」に統合、旧仕組みは凍結                                |
| 沈黙アラート            | `stale-alerts` cron                           | 求職者向け自動再アプローチは Flow で実現、既存はエージェント向け通知として存続           |
| LIFF                    | `/liff/[orgId]/*`                             | 汎用フォームルート `/liff/[orgId]/forms/[formId]` を追加(Phase 3)                        |
| Rich Menu               | `line_rich_menus`(既存メニュー ID 切替のみ)   | 作成・画像アップロード・時間帯切替を追加(Phase 4)                                        |
| Cron                    | Vercel Cron                                   | `/api/internal/ma/flow-dispatch`(1 分毎)を追加、旧 `line-dispatch` は Phase 0 完了で撤去 |

---

## 3. 全体アーキテクチャ

```
┌───────────────────────────────────────────────────────┐
│ 求職者 (LINE アプリ / LIFF)                              │
└────────────┬──────────────────────────────────────────┘
             ↕ Messaging API + LIFF
┌────────────┴──────────────────────────────────────────┐
│ LINE Platform                                          │
└────────────┬──────────────────────────────────────────┘
             ↕ Webhook / REST
┌────────────┴──────────────────────────────────────────┐
│ Myaira Runtime                                          │
│                                                        │
│  Webhook 受信 (既存)                                    │
│    └─ event ハンドラで:                                 │
│       ・friend 追加/離脱の line_user_links 更新          │
│       ・キーワード応答 (Phase 2 追加)                    │
│       ・postback による Flow 分岐条件供給                │
│       ・engagement_events 記録 (Phase 2)                │
│                                                        │
│  Flow Dispatcher (新: 1 分毎 cron)                      │
│    └─ ma_flow_subscriptions を next_action_at で走査   │
│       action_type に応じて実行:                          │
│       ・send_message / assign_tag / add_score /         │
│         set_field / branch / wait / stop                │
│                                                        │
│  Segment Resolver                                       │
│    └─ line_segments.filter_dsl_json を SQL に翻訳       │
│       Flow trigger / Broadcast target で共用            │
│                                                        │
│  CV Tracker (Phase 2)                                   │
│    └─ 応募/面談/入社イベントを ma_conversion_events に  │
│       INSERT、Flow の goal と自動照合                    │
└────────────┬──────────────────────────────────────────┘
             ↕
┌────────────┴──────────────────────────────────────────┐
│ Postgres (Supabase)                                    │
│  新規: ma_flows / ma_flow_steps / ma_flow_subscriptions │
│        line_segments / ma_conversion_events (P2)        │
│        line_engagement_events (P2) / line_auto_responses │
│        line_entry_sources / line_forms / line_broadcast_ │
│        recipients / line_rich_menu_definitions (P3-4)   │
└───────────────────────────────────────────────────────┘
```

---

## 4. データモデル(新規テーブル)

### 4.1 `ma_flows`(Phase 1)

多段シナリオの本体。1 org × N flows。

| カラム                  | 型                               | 説明                                                                                |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| id                      | uuid (PK)                        |                                                                                     |
| organization_id         | uuid FK NOT NULL                 |                                                                                     |
| name                    | text NOT NULL                    | 管理用名前                                                                          |
| description             | text                             |                                                                                     |
| channel                 | text NOT NULL DEFAULT 'line'     | 将来 email/sms 拡張の余地                                                           |
| trigger_type            | text NOT NULL                    | 後述の 7 種                                                                         |
| trigger_config          | jsonb NOT NULL DEFAULT '{}'      | trigger 別の条件(tag_id / segment_id / event_key 等)                                |
| target_segment_id       | uuid FK line_segments (nullable) | 起動時のセグメント一致必須                                                          |
| goal_event_key          | text (nullable)                  | `application_submitted` / `meeting_confirmed` 等。達成で Flow を `goal_achieved` に |
| allow_reentry           | boolean NOT NULL DEFAULT false   | 一度完了/中断した友だちを再度エンロール可能か                                       |
| max_send_per_day        | int (nullable)                   | 1 org あたりの 1 日送信上限(通数対策)                                               |
| send_time_window_json   | jsonb (nullable)                 | 深夜送信抑止 `{"only_between":{"start":"09:00","end":"20:00","tz":"Asia/Tokyo"}}`   |
| is_active               | boolean NOT NULL DEFAULT false   |                                                                                     |
| created_by              | uuid FK auth.users               |                                                                                     |
| created_at / updated_at | timestamptz                      |                                                                                     |

`trigger_type` の enum:

- `friend_added` — 友だち追加時
- `tag_assigned` — 特定タグ付与時(`trigger_config.tag_id` 必須)
- `tag_removed` — 特定タグ削除時
- `segment_matched` — セグメントに新規マッチ(定期スキャン、Phase 2)
- `form_submitted` — フォーム送信時(`trigger_config.form_id`)
- `postback_received` — 特定 postback(`trigger_config.postback_data_prefix`)
- `keyword_matched` — キーワード自動応答経由(Phase 2)
- `conversion_event` — CV イベント発生時(`trigger_config.event_key`)
- `manual` — 管理画面から特定友だち群を手動 enroll

### 4.2 `ma_flow_steps`(Phase 1)

Flow 内のステップ(送信・分岐・アクション)。

| カラム                      | 型                              | 説明                                          |
| --------------------------- | ------------------------------- | --------------------------------------------- |
| id                          | uuid (PK)                       |                                               |
| flow_id                     | uuid FK NOT NULL                |                                               |
| step_order                  | int NOT NULL                    | 1 から連番、UI 上の一意識別子                 |
| name                        | text                            | 管理用                                        |
| delay_from_previous_seconds | bigint NOT NULL DEFAULT 0       | step 1 は trigger からの遅延                  |
| action_type                 | text NOT NULL                   | 後述                                          |
| action_config               | jsonb NOT NULL DEFAULT '{}'     | action_type 別の設定                          |
| template_id                 | uuid FK ma_templates (nullable) | action=`send_message` のとき必須              |
| branch_condition_json       | jsonb (nullable)                | action=`branch` のとき必須(後述 DSL)          |
| next_step_on_true           | int (nullable)                  | step_order 参照                               |
| next_step_on_false          | int (nullable)                  | step_order 参照                               |
| next_step_on_default        | int (nullable)                  | branch 以外・両 null なら step_order+1 に進む |
| goal_check_on_entry         | boolean NOT NULL DEFAULT false  | このステップに来た時点で goal 達成判定するか  |
| created_at / updated_at     | timestamptz                     |                                               |

UNIQUE `(flow_id, step_order)`

`action_type` の enum:

- `send_message` — テンプレ配信(push / multicast どちらかは runtime で決定)
- `assign_tag` — friend にタグ付与
- `remove_tag` — friend からタグ削除
- `add_score` — engagement_score 加算(Phase 2)
- `set_field` — friend_fields(または `line_user_links.custom_display_name` 等)に値を書く
- `wait` — 送信なし、次ステップまで待つだけ(delay 表現)
- `branch` — 条件評価して分岐先ステップを決定
- `stop` — subscription を `completed` にして終了

### 4.3 `ma_flow_subscriptions`(Phase 1)

friend × Flow の進行状態。1 friend が同時に複数 Flow を走ることを許容。

| カラム                  | 型                   | 説明                                                                        |
| ----------------------- | -------------------- | --------------------------------------------------------------------------- |
| id                      | uuid (PK)            |                                                                             |
| organization_id         | uuid FK NOT NULL     | 検索最適化用の冗長列                                                        |
| flow_id                 | uuid FK NOT NULL     |                                                                             |
| line_user_id            | text NOT NULL        | line_user_links と参照するが FK は張らない(未連携友だちも許容)              |
| client_record_id        | uuid FK (nullable)   | 求職者 CRM と紐付いていれば                                                 |
| current_step_order      | int NOT NULL         |                                                                             |
| next_action_at          | timestamptz NOT NULL | cron が拾う時刻。INDEX (status, next_action_at)                             |
| status                  | text NOT NULL        | 'active' / 'goal_achieved' / 'completed' / 'canceled' / 'paused' / 'failed' |
| entered_via             | text                 | 'trigger_auto' / 'manual' / 'imported'                                      |
| entered_at              | timestamptz NOT NULL |                                                                             |
| goal_achieved_at        | timestamptz          |                                                                             |
| completed_at            | timestamptz          |                                                                             |
| last_error_at           | timestamptz          |                                                                             |
| last_error_message      | text                 |                                                                             |
| created_at / updated_at | timestamptz          |                                                                             |

UNIQUE partial index: `(flow_id, line_user_id) WHERE status IN ('active','paused')` — 同 Flow で active/paused な subscription は 1 件のみ。allow_reentry=true でも過去の完了 subscription は残る。

### 4.4 `line_segments`(Phase 1)

動的セグメント定義。Flow の target・Broadcast の絞込・手動 enroll に使用。

| カラム                  | 型                 | 説明           |
| ----------------------- | ------------------ | -------------- |
| id                      | uuid (PK)          |                |
| organization_id         | uuid FK NOT NULL   |                |
| name                    | text NOT NULL      |                |
| description             | text               |                |
| filter_dsl_json         | jsonb NOT NULL     | 後述 DSL       |
| friend_count_cache      | int                | 直近のマッチ数 |
| last_computed_at        | timestamptz        |                |
| created_by              | uuid FK auth.users |                |
| created_at / updated_at | timestamptz        |                |

### 4.5 `ma_conversion_events`(Phase 2)

friend の CV イベント。既存の応募/面談/入社ロジックから発火する。

| カラム                     | 型                   | 説明                                                                                                                       |
| -------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| id                         | uuid (PK)            |                                                                                                                            |
| organization_id            | uuid FK NOT NULL     |                                                                                                                            |
| line_user_id               | text NOT NULL        |                                                                                                                            |
| client_record_id           | uuid FK (nullable)   |                                                                                                                            |
| event_key                  | text NOT NULL        | `application_submitted` / `meeting_confirmed` / `meeting_completed` / `offer_received` / `offer_accepted` / `onboarded` 等 |
| source_flow_id             | uuid FK (nullable)   | Attribution(直近 30 日以内に送信を受けた flow)                                                                             |
| source_flow_step_id        | uuid FK (nullable)   |                                                                                                                            |
| attribution_window_seconds | bigint               | attribute した根拠の窓                                                                                                     |
| occurred_at                | timestamptz NOT NULL |                                                                                                                            |
| metadata_json              | jsonb DEFAULT '{}'   |                                                                                                                            |
| created_at                 | timestamptz          |                                                                                                                            |

INDEX `(organization_id, event_key, occurred_at DESC)`
INDEX `(source_flow_id, occurred_at DESC)`

### 4.6 `line_engagement_events`(Phase 2)

friend の熱量加点イベント。engagement_score の元帳。

| カラム              | 型                   | 説明                                                                                                               |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| id                  | uuid (PK)            |                                                                                                                    |
| organization_id     | uuid FK NOT NULL     |                                                                                                                    |
| line_user_id        | text NOT NULL        |                                                                                                                    |
| event_type          | text NOT NULL        | `link_click` / `reply_received` / `postback_selected` / `keyword_matched` / `form_submitted` / `welcome_completed` |
| points_delta        | int NOT NULL         | +5 / -3 等                                                                                                         |
| source_flow_id      | uuid FK (nullable)   |                                                                                                                    |
| source_flow_step_id | uuid FK (nullable)   |                                                                                                                    |
| metadata_json       | jsonb                |                                                                                                                    |
| occurred_at         | timestamptz NOT NULL |                                                                                                                    |

INDEX `(organization_id, line_user_id, occurred_at DESC)`

### 4.7 `line_auto_responses`(Phase 2)

キーワード自動応答定義。

| カラム                  | 型                            | 説明                                                           |
| ----------------------- | ----------------------------- | -------------------------------------------------------------- |
| id                      | uuid (PK)                     |                                                                |
| organization_id         | uuid FK NOT NULL              |                                                                |
| name                    | text NOT NULL                 |                                                                |
| keyword_pattern         | text NOT NULL                 |                                                                |
| match_mode              | text NOT NULL                 | 'exact' / 'contains' / 'starts_with' / 'regex'                 |
| template_id             | uuid FK ma_templates NOT NULL |                                                                |
| post_action_json        | jsonb DEFAULT '{}'            | `{"assign_tag": "...", "trigger_flow": "...", "add_score": 5}` |
| priority                | int NOT NULL DEFAULT 0        | 高い順に評価                                                   |
| is_active               | boolean NOT NULL DEFAULT true |                                                                |
| created_at / updated_at | timestamptz                   |                                                                |

### 4.8 `line_entry_sources`(Phase 3)

流入経路マスタ。QR / LP パラメータ / 招待コード等。

| カラム          | 型               | 説明                      |
| --------------- | ---------------- | ------------------------- |
| id              | uuid (PK)        |                           |
| organization_id | uuid FK NOT NULL |                           |
| code            | text NOT NULL    | URL パラメータ、QR 埋込値 |
| name            | text NOT NULL    |                           |
| description     | text             |                           |
| landing_url     | text (nullable)  | 経路別の LP               |
| created_at      | timestamptz      |                           |

UNIQUE `(organization_id, code)`

### 4.9 `line_forms` / `line_form_fields` / `line_form_responses`(Phase 3)

LIFF 汎用フォーム(既存の求人応募 LIFF とは別ルート `/liff/[orgId]/forms/[formId]`)。

`line_forms`: id / organization_id / name / description / is_active / post_submit_flow_id (Flow trigger 用)

`line_form_fields`: id / form_id / field_order / field_key / label / input_type (`text`|`textarea`|`radio`|`checkbox`|`select`|`date`|`email`|`tel`) / required / options_json / placeholder / UNIQUE (form_id, field_key)

`line_form_responses`: id / organization_id / form_id / line_user_id / client_record_id / response_encrypted (AES-256-GCM 暗号化 JSON) / submitted_at

### 4.10 `line_broadcast_recipients`(Phase 3)

一斉配信の user 単位ログ。既存 `line_broadcasts` は slice 単位でしか成否を残さないため補完。

| カラム          | 型               | 説明                          |
| --------------- | ---------------- | ----------------------------- |
| id              | uuid (PK)        |                               |
| broadcast_id    | uuid FK NOT NULL |                               |
| organization_id | uuid FK NOT NULL |                               |
| line_user_id    | text NOT NULL    |                               |
| status          | text NOT NULL    | 'sent' / 'failed' / 'blocked' |
| line_request_id | text             | X-Line-Request-Id             |
| error_message   | text             |                               |
| sent_at         | timestamptz      |                               |

INDEX `(broadcast_id, status)`

### 4.11 `line_rich_menu_definitions`(Phase 4)

自作リッチメニュー + 時間帯切替スケジュール。

| カラム                  | 型                             | 説明                                 |
| ----------------------- | ------------------------------ | ------------------------------------ |
| id                      | uuid (PK)                      |                                      |
| organization_id         | uuid FK NOT NULL               |                                      |
| name                    | text NOT NULL                  |                                      |
| line_rich_menu_id       | text                           | 作成後の LINE 側 ID                  |
| image_ref               | text                           | Supabase Storage パス                |
| config_json             | jsonb NOT NULL                 | areas 定義                           |
| target_segment_id       | uuid FK (nullable)             | このメニューを表示する対象セグメント |
| is_default_menu         | boolean NOT NULL DEFAULT false |                                      |
| default_from_hour       | int (nullable)                 | 時間帯切替(0-23)                     |
| default_to_hour         | int (nullable)                 |                                      |
| created_at / updated_at | timestamptz                    |                                      |

---

## 5. 既存テーブルの拡張

- `line_user_links` に列追加:
  - `engagement_score int NOT NULL DEFAULT 0`(Phase 2)
  - `engagement_score_updated_at timestamptz`(Phase 2)
  - `entry_source_code text`(Phase 3)
- `ma_send_logs` に列追加:
  - `ma_flow_step_id uuid` FK ma_flow_steps (Phase 1)
- `ma_click_links` に列追加:
  - `ma_flow_step_id uuid` FK ma_flow_steps (Phase 1)

---

## 6. DSL 仕様

### 6.1 `filter_dsl_json`(セグメント)

セグメント条件を宣言的 JSON で表現、実行時に SQL に翻訳する。

```json
{
  "operator": "and",
  "conditions": [
    { "kind": "has_tag", "tag_id": "..." },
    { "kind": "not_has_tag", "tag_id": "..." },
    { "kind": "score_gte", "value": 20 },
    { "kind": "field_equals", "key": "希望勤務地", "value": "東京" },
    { "kind": "field_exists", "key": "職務要約" },
    { "kind": "days_since_last_activity_gte", "days": 30 },
    { "kind": "days_since_added_lte", "days": 7 },
    { "kind": "entry_source_in", "codes": ["qr_lp01", "qr_event02"] },
    { "kind": "conversion_event_present", "event_key": "meeting_confirmed", "within_days": 30 },
    { "kind": "conversion_event_absent", "event_key": "application_submitted", "within_days": 14 },
    { "kind": "clicked_link_in_flow", "flow_id": "..." },
    {
      "kind": "or",
      "conditions": [
        /* nested */
      ]
    }
  ]
}
```

`operator` は `and` / `or`。ネスト可能。

### 6.2 `branch_condition_json`(Flow ステップ内の分岐条件)

セグメント DSL と同構造を再利用。加えて Flow 実行文脈の条件を許可:

- `postback_data_equals` / `postback_data_prefix`
- `replied_since_previous_step`(前ステップ以降に返信あり)
- `clicked_link_in_step` / `clicked_link_in_previous`

### 6.3 `action_config`(action_type 別)

- `send_message`: `{}`(template_id で送信)
- `assign_tag`: `{ "tag_id": "..." }`
- `remove_tag`: `{ "tag_id": "..." }`
- `add_score`: `{ "delta": 5, "event_type": "postback_selected" }`
- `set_field`: `{ "key": "希望職種", "value": "SRE" }` または `{ "key": "希望職種", "value_from_postback": true }`
- `wait`: `{}`
- `branch`: `{}`(条件は `branch_condition_json`)
- `stop`: `{ "reason": "opted_out" }`(subscription を `canceled` に)

---

## 7. データフロー

### 7.1 Trigger → Subscription 作成

**イベント側**:

- `friend_added`: webhook `follow` イベントで発火
- `tag_assigned`: `line_conversation_tag_assignments` の INSERT トリガー(または API 層)
- `postback_received`: webhook `postback` で発火
- `form_submitted`: フォーム送信 API
- `conversion_event`: `ma_conversion_events` INSERT トリガー
- `segment_matched`: 15 分毎の cron で segment を走査、新規マッチを検出
- `keyword_matched`: `line_auto_responses` 処理内で発火

**Enroll ロジック**:

1. 該当 `ma_flows`(is_active=true, trigger_type 一致)を取得
2. `target_segment_id` があればセグメント条件を評価
3. `allow_reentry=false` の場合、既存の完了 subscription があれば skip
4. `ma_flow_subscriptions` を INSERT(current_step_order=1、next_action_at = now() + step1.delay)
5. `entered_at`, `entered_via`, `status='active'` を設定

### 7.2 Cron dispatcher(1 分毎)

`/api/internal/ma/flow-dispatch`:

```
SELECT * FROM ma_flow_subscriptions
WHERE status='active' AND next_action_at <= now()
ORDER BY next_action_at ASC
LIMIT 200;
```

各 subscription について:

1. `ma_flow_steps` を lookup(flow_id + current_step_order)
2. **goal_check_on_entry=true** かつ goal_event_key があれば `ma_conversion_events` を最新から確認 → 一致で `status='goal_achieved'` にして break
3. **send_time_window_json** 制約チェック → 範囲外なら次営業時間帯まで `next_action_at` を延期
4. **max_send_per_day** チェック(action=send_message の場合)
5. `action_type` 実行:
   - `send_message`: テンプレ復号 → 変数展開 → `wrapBodyUrls` でクリック URL 短縮 → push、`ma_send_logs` に記録(`ma_flow_step_id` 付き)
   - `assign_tag` / `remove_tag`: `line_conversation_tag_assignments` を操作
   - `add_score`: `line_engagement_events` に INSERT、`line_user_links.engagement_score` を UPDATE
   - `set_field`: `friend_fields` に UPSERT
   - `wait`: 何もしない
   - `branch`: `branch_condition_json` を評価 → next_step_on_true/false を選択
   - `stop`: `status='completed'` / `canceled` に更新して break
6. 次ステップ決定:
   - `branch` 以外:`next_step_on_default` があればそれ、なければ step_order+1
   - 存在しなければ `status='completed'`
7. `current_step_order`、`next_action_at = now() + next_step.delay_from_previous_seconds` を UPDATE
8. エラー時は `last_error_at` / `last_error_message` を記録、リトライ 3 回まで(指数バックオフ)、超えたら `status='failed'`

### 7.3 CV 追跡と Attribution(Phase 2)

CV 発火源:

- 応募:既存 `referrals` INSERT トリガー → `ma_conversion_events(event_key='application_submitted')`
- 面談確定:`interviews.status='confirmed'` UPDATE → `event_key='meeting_confirmed'`
- 面談実施:同 `completed` → `meeting_completed`
- 内定:`offer_deadline_at` セット時 → `offer_received`
- 承諾:内定回答時 → `offer_accepted`
- 入社:`onboarded_at` 記録時 → `onboarded`

Attribution 計算(INSERT トリガー内):

1. 該当 friend の `ma_send_logs` を直近 30 日 で SELECT
2. 最新の送信を `source_flow_id` / `source_flow_step_id` として記録(last-touch attribution)
3. `attribution_window_seconds = now - last_send.sent_at`

同時に該当 friend の active な Flow subscription で `goal_event_key` が一致するものがあれば `status='goal_achieved'` に。

---

## 8. UI 設計

### 8.1 `/agency/marketing/flows`(Phase 1)

- Flow 一覧(ステータス / trigger / 対象数 / 直近 CV 率)
- 「新規 Flow 作成」ボタン
- 各 Flow 行から編集画面へ

### 8.2 `/agency/marketing/flows/[id]/edit`(Phase 1)

- 左サイドバー:Flow メタ(trigger / target segment / goal / 送信時間帯 / active)
- 中央:ステップビルダー(縦並びカード + ドラッグ並替)
  - 各カード:action_type / delay / template preview / 分岐先
  - 「+ ステップ追加」ボタンで挿入
  - 分岐カードは true/false 2 枝を視覚化
- 右サイドバー:テストシミュレーター(仮想 friend の状態を入力 → 各ステップの評価結果を表示)

### 8.3 `/agency/marketing/segments`(Phase 1)

- セグメント一覧(名前 / マッチ数キャッシュ / 更新日時)
- 編集画面:条件ビルダー(AND / OR ネスト、kind 別のフィールド)
- プレビュー:「現時点で N 人が一致」+ 直近 10 件のサンプル

### 8.4 `/agency/marketing/flows/[id]/analytics`(Phase 2)

- ステップ別到達率 / 離脱率
- 目標達成率(CV / 到達数)
- 平均 attribution window
- ROI 試算(送信通数 × 単価 vs CV 経済価値)

### 8.5 `/agency/marketing/auto-responses`(Phase 2)

- キーワード応答 CRUD、priority 並替、テスト送信

### 8.6 `/agency/marketing/forms`(Phase 3)

- フォームビルダー(フィールドタイプ選択 + 順序 + 必須設定)
- 公開 URL(LIFF)発行、QR 表示

### 8.7 `/agency/marketing/rich-menus`(Phase 4)

- リッチメニュー画像アップロード + area 定義
- 対象セグメント選択、時間帯切替設定

---

## 9. Phase 分割

### Phase 0(Prep):既存プリセットの吸収

期間目安:1 週

- `ma_flows` / `ma_flow_steps` / `ma_flow_subscriptions` migration 投入(まだ dispatch はしない)
- 既存 7 プリセットを対応する Flow として初期データ投入
  - `line_welcome_after_friend` → 「オンボーディング Flow」(3 ステップ:即時 welcome / +6h 棚卸し誘導 / +3d branch)
  - `line_dormant_outreach` → 「沈黙復帰 Flow」(3 ステップ:30d アプローチ / +7d 再送 / +14d 卒業案内)
  - `line_meeting_reminder` → 「面談前リマインド Flow」(2 ステップ:24h 前 / 1h 前)
  - `line_register_meeting_promotion` → 「面談誘導 Flow」
  - `line_job_introduction` → 「求人紹介 Flow」
  - `line_after_interview_followup` → 「面接後フォロー Flow」
  - `line_birthday_greeting` → 「誕生日メッセージ Flow」
- 新旧 cron を並走させる期間の重複送信防止:既存 `ma_scenarios` が有効な org は新 Flow を is_active=false で投入
- 移行完了時点で `ma_scenarios` の新規 INSERT を API 層で拒否、旧 cron を撤去

### Phase 1(Lstep-Core):多段配信 + 動的セグメント

期間目安:3〜4 週

- `ma_flows` / `ma_flow_steps` / `ma_flow_subscriptions` を実装(dispatch 稼働)
- `line_segments` 実装
- `filter_dsl_json` / `branch_condition_json` の評価エンジン
- `/agency/marketing/flows` UI(一覧 + ビルダー + テストシミュレーター)
- `/agency/marketing/segments` UI
- 既存 broadcast の対象絞込に `line_segments` を選択肢として追加

### Phase 2(計測 & 熱量):CV / スコア / 自動応答

期間目安:3 週

- `ma_conversion_events` + trigger 実装(referrals / interviews / offer / onboarding からのフック)
- `line_engagement_events` + `line_user_links.engagement_score` 更新
- `line_auto_responses` 実装(webhook `handleMessage` にキーワード評価を追加)
- Attribution ロジック(last-touch)
- `/agency/marketing/flows/[id]/analytics` UI
- `/agency/marketing/auto-responses` UI
- 熱量スコア一定以上でアドバイザーに in-app 通知(既存 `stale-alerts` の逆パターン)

### Phase 3(流入 & 属性):フォーム / entry_sources / user 単位ログ

期間目安:3 週

- `line_entry_sources` + `line_user_links.entry_source_code` + friend 追加時の source 判定
- `line_forms` / `line_form_fields` / `line_form_responses`(暗号化保存)
- LIFF フォームルート `/liff/[orgId]/forms/[formId]`
- `line_broadcast_recipients` 実装 + 既存 broadcast dispatcher の修正
- `/agency/marketing/forms` UI(フォームビルダー)
- 流入経路別 KPI ダッシュボード

### Phase 4(仕上げ):リッチメニュー & narrowcast

期間目安:2 週

- `line_rich_menu_definitions` + LINE Messaging API の createRichMenu / uploadRichMenuImage / setDefault / linkRichMenuToUser
- 時間帯切替 cron
- `lib/line/api.ts` に narrowcast 実装 + Broadcast の送信オプション追加

---

## 10. 求職者マーケティングの代表シナリオ(Phase 1 初期投入)

### 10.1 オンボーディング Flow(既存 `line_welcome_after_friend` の拡張)

trigger: `friend_added`

- Step 1 (0s): `send_message` — Welcome text + キャリア棚卸し LIFF リンク
- Step 2 (+21600s = 6h): `send_message` — Flex カード「棚卸しを始めましょう」+ ボタン(棚卸し開始 / あとで)
- Step 3 (+3d): `branch` — 棚卸し完了(`conversion_event_present: profile_completed`)ならスキップ、未了ならリマインド
- Step 3a (未了 → 分岐 true): `send_message` — サンプル職務要約 + 3 分で終わる案内
- Step 4 (+7d): `assign_tag` — オンボーディング完了群
- goal_event_key: `profile_completed`

### 10.2 面談誘導 Flow

trigger: `tag_assigned`(タグ: 書類完了)

- Step 1 (0s): `send_message` — Flex 面談日程候補(既存 `handlePostback` の `line_meeting_proposal:` と連動)
- Step 2 (+1d): `branch` — 予約済(`has_tag: 面談予約済`)ならスキップ
  - true: `stop`
- Step 3 (+3d): `send_message` — 別角度(面談で得られる情報の例示)
- goal_event_key: `meeting_confirmed`

### 10.3 面談前リマインド Flow(既存 `line_meeting_reminder` の再現)

trigger: `conversion_event`(event_key: `meeting_confirmed`)

- Step 1 (面談 24h 前): `send_message` — 事前準備リンク + カメラ/マイクチェック案内
- Step 2 (面談 1h 前): `send_message` — Zoom URL 再送

※ 面談 24h/1h 前という「絶対時刻からの逆算」は `next_action_at` 計算時に `meetings.scheduled_at - N` として算出

### 10.4 沈黙復帰 Flow

trigger: `segment_matched`(セグメント: 「30 日以上活動なし」)

- Step 1: `send_message` — 「お元気ですか?」+ 3 択 quick reply(転職継続 / 一旦保留 / 通知不要)
- Step 2 (+7d): `branch` — 前ステップ以降に返信あるか
  - false: 別角度(状況変化の例示)
- Step 3 (+14d): `branch` — なお反応なし → 卒業メッセージ + 「再開時はこちら」LINK
- goal_event_key: なし(反応イベントで自動 goal_achieved)

### 10.5 面接後フォロー Flow

trigger: `conversion_event`(event_key: `interview_completed`)

- Step 1 (0s): `send_message` — 感謝 + LIFF フォーム(感触アンケート)
- Step 2 (+3d): `send_message` — 結果連絡までの過ごし方コンテンツ
- Step 3 (+7d): `branch` — 結果通知タグ(`has_tag: 結果連絡済`)
  - true: `stop`
  - false: 「進捗確認できます」+ 担当者連絡ボタン
- goal_event_key: `offer_received` OR `interview_result_declined`

---

## 11. セキュリティ / RLS / 暗号化

- 全新規テーブルに `organization_id` を持たせ、既存パターン(0002 ADR)通り RLS で `organization_members` メンバーのみアクセス許可
- `line_form_responses.response_encrypted` は AES-256-GCM で暗号化(既存 `field-encryption` パターン踏襲)
- `ma_flow_subscriptions.line_user_id` は暗号化しない(検索/JOIN で必須のため)。既存 `line_user_links.line_user_id` と同方針
- Flow dispatcher は service_role キーで動作、RLS バイパス
- Webhook 経路の自動応答 / postback 分岐は既存署名検証を経由するため追加防御不要
- 求職者からの opt-out(自動応答キーワード「配信停止」等)を Phase 2 で組み込む — `ma_flow_subscriptions` を一括 `canceled` にし、`line_user_links` に `marketing_opt_out=true` フラグ列を追加

---

## 12. 通数コスト対策

LINE 公式アカウントの通数上限(現行プランに準拠)に対する保護:

- Flow 単位の `max_send_per_day`(超過分は翌日に繰越)
- 組織全体の月次通数上限を `line_channels.monthly_message_quota` で管理(Phase 2 で追加)
- Dispatcher は送信前に quota チェック → 超過分は `status='paused'` にして翌月初に自動 resume
- Broadcast は既存の slice ロジック踏襲、Flow との合算集計をダッシュボードに表示

---

## 13. 未決事項

| #   | 論点                                                                   | 提案                                                             |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | segment_matched trigger の走査間隔                                     | Phase 2 開始まで置いておき、15 分粒度で開始                      |
| 2   | Attribution モデル                                                     | 初期は last-touch。multi-touch は将来検討                        |
| 3   | Opt-out の実装粒度                                                     | Phase 2 で「Flow 単位」ではなく「マーケ全体」の 1 フラグから開始 |
| 4   | narrowcast の使い分け閾値                                              | 500 friends 超で自動選択、Phase 4 で実装                         |
| 5   | Flow ビルダーの分岐可視化ライブラリ                                    | React Flow(既存依存なし)を検討、Phase 1 序盤で決定               |
| 6   | 既存 `stale-alerts`(エージェント通知)と沈黙復帰 Flow(求職者向け)の共存 | 別レイヤとして両方稼働、UI で紐付け表示                          |

---

## 14. 次のアクション

1. 本ドキュメントの承認
2. Phase 0 の詳細実装計画(migration DDL / 既存 preset マッピングテーブル / cron カットオーバー手順)を作成
3. Phase 0 を dev(pfebbpgcufintmulhydg)に適用 → 動作確認
4. Phase 0 完了後に Phase 1 着手
