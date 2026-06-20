# LINE 公式アカウント 連携 設計

ステータス:**仕様 確定、 実装着手 待ち**
最終更新:2026-06-20

エージェント 企業 の LINE 公式アカウント と Maira を 連携 し、
求職者 ↔ エージェント の LINE やり取り を Maira UI で 完結 + 求人共有 / Zoom 案内 を LINE で 行う。

---

## 1. 確定 した 仕様 (Q1〜Q7)

| 項目                     | 内容                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **対応範囲**             | Phase 1〜4 全部(基本連携 + リッチコンテンツ + Zoom 連携 + LIFF / 一斉配信)                                                 |
| **紐付け 方式**          | エージェント手動 + 求職者連携コード の **ハイブリッド**                                                                    |
| **求人紹介**             | **LIFF で LINE 内 完結**(求人詳細 / 応募ボタン)                                                                            |
| **LINE OA**              | 既存運用前提(設定取込 のみ サポート、 新規開設 ガイド は 後回し)                                                           |
| **暗号化**               | LINE メッセージ も `encrypted_content` (AES-256-GCM v2 形式)で 保存。 添付バイナリ は Supabase Storage + メタデータ 暗号化 |
| **通知**                 | メール + Maira アプリ内通知 + Slack Webhook の **3 つ すべて 切替 可**                                                     |
| **Channel Access Token** | 既存 Zoom / Google 連携 と 同じ 暗号化 レベル(field-encryption)                                                            |

---

## 2. 全体 アーキテクチャ

```
┌───────────────────────────────────────────────────────┐
│ 求職者 (LINE アプリ)                                    │
│   ・テキスト / 画像 / スタンプ メッセージ                  │
│   ・LIFF 内ブラウザ で 求人詳細 + 応募                   │
└────────────┬──────────────────────────────────────────┘
             ↕ Messaging API + LIFF
┌────────────┴──────────────────────────────────────────┐
│ LINE Platform                                          │
│   ・Channel = エージェント企業の 公式アカウント            │
│   ・Channel Access Token (長期) を Maira が 預かる       │
│   ・Webhook URL = https://maira.pro/api/webhooks/line/X  │
└────────────┬──────────────────────────────────────────┘
             ↕ Webhook (受信) + REST API (送信)
┌────────────┴──────────────────────────────────────────┐
│ Maira (Next.js + Supabase)                             │
│   ・line_channels (org ごとの 設定)                       │
│   ・line_user_links (LINE userId ↔ client_record)        │
│   ・line_messages (encrypted_content)                    │
│   ・line_broadcasts (一斉配信履歴)                       │
│   ・LIFF ホスト = /liff/* ルート                          │
└────────────┬──────────────────────────────────────────┘
             ↕ UI
┌────────────┴──────────────────────────────────────────┐
│ エージェント (ブラウザ / Maira UI)                       │
│   ・LINE風 チャット (/agency/line)                       │
│   ・求人 / 日程 を Flex で 送信                            │
│   ・一斉配信 / タグ 管理                                  │
│   ・配信分析 ダッシュボード                                │
└───────────────────────────────────────────────────────┘
```

---

## 3. DB スキーマ

### 3-1. `line_channels` (org ごとの LINE 設定)

```sql
create table public.line_channels (
  organization_id uuid primary key references public.organizations(id) on delete cascade,

  -- LINE Developers コンソール から 取得
  line_channel_id text not null unique,         -- (公開) 数値の Channel ID
  line_channel_secret_encrypted text not null,  -- (機密) v{n}: 形式 暗号化
  line_channel_access_token_encrypted text not null,  -- (機密) 長期トークン
  line_bot_user_id text,                        -- @xxxxx LINE Bot の userId

  -- Webhook 設定 (LINE 側 が Maira に 向ける URL)
  webhook_token text not null unique,           -- URL 含み トークン (推測困難)

  -- LIFF (Phase 4)
  liff_id text,                                 -- LIFF アプリ ID (1 つ)

  -- 課金プラン (LINE 側、 参考表示用)
  line_plan text check (line_plan in ('free', 'light', 'standard') or line_plan is null),
  monthly_message_quota int,                    -- LINE側 月次 上限 (例: 200 / 5000 / 30000)

  -- 状態
  is_active boolean not null default true,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 3-2. `line_user_links` (LINE userId ↔ client_records)

```sql
create table public.line_user_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  line_user_id text not null,                   -- (公開) LINE 側 userId (U + 32 hex)
  client_record_id uuid references public.client_records(id) on delete set null,

  -- LINE 友達 情報 (取得時 のみ更新、 平文 で OK)
  display_name text,
  picture_url text,

  -- 紐付け メタ
  linked_at timestamptz,
  link_method text check (link_method in ('manual', 'code', 'liff_login') or link_method is null),
  unfollowed_at timestamptz,                    -- ブロック / 友達解除

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, line_user_id)
);
```

### 3-3. `line_link_codes` (求職者側 連携コード)

```sql
create table public.line_link_codes (
  code text primary key,                        -- 6 桁数字 + アルファベット
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_record_id uuid not null references public.client_records(id) on delete cascade,
  expires_at timestamptz not null,              -- 24 時間
  consumed_by_line_user_id text,                -- 使用時 に LINE userId を セット
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
```

### 3-4. `line_messages` (送受信メッセージ)

```sql
create type public.line_message_direction as enum ('inbound', 'outbound');
create type public.line_message_type as enum (
  'text', 'sticker', 'image', 'video', 'audio', 'file', 'location',
  'flex', 'template', 'system'   -- system = 「ユーザーがブロックしました」等
);

create table public.line_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  line_user_id text not null,                   -- 平文 (LINE側公開ID)
  client_record_id uuid references public.client_records(id) on delete set null,

  direction public.line_message_direction not null,
  message_type public.line_message_type not null,

  -- 内容 (暗号化)
  encrypted_content text,                       -- テキスト or Flex JSON
  attachment_storage_path text,                 -- 画像 / ファイル の Storage パス (平文)
  sticker_package_id text,                      -- スタンプは ID で 復元
  sticker_id text,

  -- LINE 側 メタ
  line_message_id text unique,                  -- 受信メッセージ の ID (冪等性)
  reply_token text,                             -- 受信時 のみ。 30 秒 で 失効
  reply_token_expires_at timestamptz,

  -- 送信ステータス (outbound)
  send_status text check (send_status in ('queued', 'sent', 'failed', 'reply', 'push') or send_status is null),
  send_method text check (send_method in ('reply', 'push', 'multicast') or send_method is null),
  send_error text,

  -- 既読 (求職者側で 既読 が 取れる の は LIFF 経由のみ。 通常 LINE は 既読不明)
  read_at timestamptz,

  -- 関連 (Phase 3 Zoom / 求人紹介 追跡)
  related_job_id uuid references public.job_postings(id) on delete set null,
  related_meeting_schedule_id uuid references public.meeting_schedules(id) on delete set null,

  created_at timestamptz not null default now()
);

create index idx_line_messages_org_user_created
  on public.line_messages (organization_id, line_user_id, created_at desc);
```

### 3-5. `line_broadcasts` (一斉配信、 Phase 4)

```sql
create table public.line_broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete set null,

  -- 送信内容 (暗号化)
  encrypted_content text not null,              -- テキスト / Flex JSON
  message_type public.line_message_type not null,

  -- ターゲット (タグ または LINE 全友達)
  target_filter jsonb not null,                 -- {kind: 'tags' | 'all', tagIds: [...]}
  target_count int not null,

  -- ステータス
  status text not null check (status in ('queued', 'sending', 'sent', 'failed')),
  sent_count int not null default 0,
  failed_count int not null default 0,
  scheduled_for timestamptz,                    -- 予約配信
  sent_at timestamptz,

  created_at timestamptz not null default now()
);
```

### 3-6. RLS 方針

- 全 テーブル で RLS 有効
- SELECT は 同 org メンバー
- INSERT / UPDATE は **service_role 経由**(API ハンドラ で 認可、 RLS で 直接書込み 不可)
- `line_link_codes` の consume だけは 求職者(LINE webhook 経由)が 触る → service_role
- `line_user_links` は 公開 メタ(display_name / picture_url)あり、 機密扱い しない

---

## 4. API エンドポイント

### 4-1. Webhook 受信

```
POST /api/webhooks/line/[webhookToken]
```

- LINE 署名検証 (HMAC-SHA256, X-Line-Signature)
- `webhookToken` で どの org か 特定
- event を 種別 ごと に 処理:
  - `message`:line_messages に INSERT + 通知 fan-out
  - `follow`:line_user_links に upsert (display_name 取得)
  - `unfollow`:line_user_links.unfollowed_at セット
  - `postback`:ボタンタップ → Flex の data 解釈 → 日程確定 / 応募 等
  - `accountLink`:LINE Login 連携 (Phase 4)

### 4-2. エージェント 側 (Maira UI 経由)

| エンドポイント                                             | 役割                                       |
| ---------------------------------------------------------- | ------------------------------------------ |
| `POST /api/agency/line/channel`                            | LINE Channel 設定 登録 / 更新              |
| `GET /api/agency/line/channel`                             | 現状 取得 (検証 結果含む)                  |
| `POST /api/agency/line/channel/verify`                     | Token 有効性 検証 (Bot 情報 取得)          |
| `GET /api/agency/line/conversations`                       | チャット一覧 (最新メッセージ順)            |
| `GET /api/agency/line/conversations/[lineUserId]/messages` | メッセージ履歴                             |
| `POST /api/agency/line/messages`                           | 送信 (text / image / Flex)                 |
| `POST /api/agency/line/link-codes`                         | 連携コード 発行 (client_record 指定)       |
| `POST /api/agency/line/user-links/manual`                  | 手動 紐付け (client_record × line_user_id) |
| `POST /api/agency/line/share-job`                          | 求人 を Flex で 送信 (LIFF URL 付き)       |
| `POST /api/agency/line/share-meeting`                      | Zoom 日程候補 を 送信                      |
| `POST /api/agency/line/broadcasts`                         | 一斉配信 開始 (Phase 4)                    |
| `GET /api/agency/line/broadcasts`                          | 配信履歴 + 統計                            |

### 4-3. LIFF (Phase 4)

| パス                    | 役割                                      |
| ----------------------- | ----------------------------------------- |
| `/liff/jobs/[jobId]`    | LINE 内 で 求人詳細 表示 + 応募 ボタン    |
| `/liff/apply/[jobId]`   | LINE Login ID から seeker 認証 → 応募作成 |
| `/liff/meeting-confirm` | 日程 確定 用 (Flex postback 経由 も 可)   |

---

## 5. UI ページ

### 5-1. エージェント 側

| パス                                 | 用途                              |
| ------------------------------------ | --------------------------------- |
| `/agency/line`                       | チャット 一覧 (LINE風 サイドバー) |
| `/agency/line/[lineUserId]`          | 個別 チャット (LINE 風 バブル UI) |
| `/agency/line/broadcasts`            | 一斉配信 (Phase 4)                |
| `/agency/line/users`                 | LINE 友達 一覧 + 紐付け 状態      |
| `/agency/settings/integrations/line` | Channel 設定                      |

### 5-2. LINE風 デザイン 方針

- 背景:LINE のチャット 背景 (#7295A8 グラデ) または 白
- 自分 (エージェント) のバブル:右、緑 (#06C755)
- 相手 (求職者) のバブル:左、白 + グレー枠
- スタンプ:画像 表示 (CDN: stickershop.line-scdn.net)
- リアクション / 既読:既読不明 の ため 「送信済 ✓」のみ
- フォント:Hiragino Sans / Noto Sans JP
- 入力欄:下固定、 スタンプ / 画像 / 求人共有 / Zoom 案内 ボタン

---

## 6. LINE Messaging API 詳細

### 6-1. メッセージ 送信 (Push vs Reply)

```ts
// Reply (無料、 受信 から 30 秒以内 のみ)
POST https://api.line.me/v2/bot/message/reply
{ replyToken, messages: [...] }

// Push (1 通あたり 課金通数 1)
POST https://api.line.me/v2/bot/message/push
{ to: lineUserId, messages: [...] }

// Multicast (1 回 で 500 人 まで、 課金通数 = 配信数)
POST https://api.line.me/v2/bot/message/multicast
{ to: [lineUserId, ...], messages: [...] }
```

- Maira は `replyToken_expires_at` を 見て、 30 秒以内 なら Reply、 過ぎていたら Push に 自動切替
- UI で 「Reply 中 / Push 切替済」を 表示 (コスト 見える化)

### 6-2. Flex Message (求人 紹介 例)

```json
{
  "type": "flex",
  "altText": "求人のご案内: フロントエンドエンジニア",
  "contents": {
    "type": "bubble",
    "hero": { "type": "image", "url": "...", "size": "full", "aspectRatio": "20:13" },
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        { "type": "text", "text": "フロントエンドエンジニア", "weight": "bold", "size": "xl" },
        { "type": "text", "text": "株式会社○○ / 東京", "color": "#888", "margin": "sm" },
        {
          "type": "text",
          "text": "年収 500〜800 万円",
          "weight": "bold",
          "color": "#06C755",
          "margin": "md"
        }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "vertical",
      "spacing": "sm",
      "contents": [
        {
          "type": "button",
          "style": "primary",
          "color": "#06C755",
          "action": {
            "type": "uri",
            "label": "詳細を見る",
            "uri": "https://liff.line.me/{liffId}/jobs/{jobId}"
          }
        }
      ]
    }
  }
}
```

### 6-3. Quick Reply (Zoom 日程提示 例)

```json
{
  "type": "text",
  "text": "面談 日程 を 以下 から お選び ください:",
  "quickReply": {
    "items": [
      {
        "type": "action",
        "action": {
          "type": "postback",
          "label": "6/22 14:00",
          "data": "meeting_select:slot_abc123"
        }
      },
      {
        "type": "action",
        "action": {
          "type": "postback",
          "label": "6/22 16:00",
          "data": "meeting_select:slot_def456"
        }
      },
      {
        "type": "action",
        "action": { "type": "postback", "label": "別の日時", "data": "meeting_other" }
      }
    ]
  }
}
```

→ webhook で postback 受信 → meeting_schedule に INSERT + Zoom 招待 を Reply で 返す

### 6-4. Rich Menu 動的 切替

- 「未連携 求職者」用 メニュー:[Maira と 連携する]
- 「連携済」用 メニュー:[求人 を見る] [面談予約] [問い合わせ]
- LINE API: `POST /v2/bot/user/{userId}/richmenu/{richMenuId}`

---

## 7. 暗号化 / セキュリティ

### 7-1. 暗号化 対象

| 項目                           | 方式                                               |
| ------------------------------ | -------------------------------------------------- |
| Channel Secret / Access Token  | `lib/crypto/field-encryption` (v{n}: 形式)         |
| Message テキスト (text / flex) | `encrypted_content` 列 (同上)                      |
| 画像 / 動画 / ファイル         | Supabase Storage 'line-attachments' バケット (RLS) |
| 添付メタデータ (Storage path)  | 平文 OK (path 自体は org_id を 含むため)           |
| LINE userId / display_name     | 平文 (公開情報)                                    |

### 7-2. Webhook 検証

```ts
import { createHmac, timingSafeEqual } from "crypto";

function verifyLineSignature(body: string, signature: string, channelSecret: string): boolean {
  const hmac = createHmac("sha256", channelSecret).update(body).digest("base64");
  return timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}
```

- 失敗時 即 401 + ログ (攻撃 検知)
- webhookToken は URL path 含み → 漏洩時 即 ローテーション

### 7-3. プライバシー ポリシー 改定

- 「LINE 公式アカウント 連携 機能 を 利用 した 場合、 やり取り を Maira サーバ上 で 暗号化保存 する」を 明記
- 求職者 が LINE で 初回 メッセージ 送信時 に LIFF で 「Maira での 保管 同意」を 取る (Phase 4)

---

## 8. コスト 管理 / Reply Token 推進

LINE は 「30 秒以内 Reply は 無料、 それ以後 Push は 課金」。

### Maira UI 工夫:

- 受信 メッセージ に **「Reply 残 25 秒」**バナー
- エージェント が ブラウザ で 開いた 時 サウンド通知 + バッジ
- **自動Reply オプション**:営業時間外 / 初回友達追加 時 に 定型文 を Reply で 返す
- 既存 Slack 通知 と 連動 で 「LINE 来てます!」を Slack に 即時 流す

→ Reply Token 活用率 を UI で 表示 (コスト見える化)

---

## 9. 通知 fan-out (Q6: D)

新規 LINE メッセージ 受信時、 org の 通知設定 に 応じて:

1. **メール**:Resend で 送信 (本文 抜粋 + Maira リンク)
2. **Maira アプリ内通知**:既存 `fireSeekerNotification` 同等 を agency 側 にも 用意
3. **Slack Webhook**:既存 org.slack_webhook_url 流用

各 メンバー の `organization_members.notification_prefs` で 個別 on/off 可。

---

## 10. 実装 フェーズ (確定)

### Phase 1:基本連携 + チャット UI (10 chunks、 約 2 週)

1. DB スキーマ (line_channels, line_user_links, line_messages, line_link_codes)
2. Channel 設定 UI + API (登録 / 検証 / Token 暗号化)
3. Webhook 受信 + 署名検証 (`/api/webhooks/line/[webhookToken]`)
4. Inbound message 保存 + 暗号化 + 冪等性
5. Outbound 送信 API (Reply / Push 自動切替)
6. 連携コード 発行 + LINE 経由 紐付け (B)
7. 手動 紐付け UI (A:既存 友達 から client_record 選択)
8. LINE風 チャット 一覧 UI (`/agency/line`)
9. LINE風 個別 チャット UI (`/agency/line/[lineUserId]`)
10. 通知 fan-out (メール / アプリ内 / Slack)

### Phase 2:リッチコンテンツ + 求人共有 (6 chunks、 約 1.5 週)

11. 画像 / ファイル 送受信 (Supabase Storage 'line-attachments')
12. スタンプ 表示 / 送信
13. Flex Message ビルダー ライブラリ (`lib/line/flex-builder.ts`)
14. 求人 を Flex で 送信 (Phase 4 LIFF URL は 暫定 で 通常 URL)
15. Quick Reply / 自動Reply 設定
16. UI 統合 (スタンプ ピッカー / 画像 アップロード / 求人選択)

### Phase 3:Zoom 連携 (4 chunks、 約 1 週)

17. 日程候補 生成 + Flex 化 (meeting_schedules + Zoom 連携 流用)
18. postback で 日程確定 → meeting_schedule INSERT
19. Zoom 招待 を Reply で 自動送信
20. リスケ / キャンセル フロー

### Phase 4:LIFF + 一斉配信 + 分析 (6 chunks、 約 1.5 週)

21. LIFF アプリ 登録 ガイド + DB 保存
22. `/liff/jobs/[jobId]` ページ (LINE Login で seeker 認証)
23. `/liff/apply/[jobId]` 応募フロー
24. Rich Menu 動的 切替
25. 一斉配信 (Multicast、 タグ ベース)
26. 配信分析 ダッシュボード

**合計:約 6 週、 26 chunks**

---

## 11. 関連 既存 実装

- `lib/integrations/zoom-*.ts` / `lib/integrations/google-*.ts`:外部API 連携 パターン 参考
- `lib/crypto/field-encryption.ts`:Token / メッセージ 暗号化
- `lib/notifications/in-app.ts`:アプリ内 通知 fan-out
- `lib/email/*.ts`:メール 通知 パターン
- `app/api/webhooks/stripe/route.ts`:Webhook 署名検証 パターン
- `meeting_schedules` / `meeting_interview_shares`:Phase 3 で 流用

---

## 12. 未決 / 後日 確認

1. LIFF アプリ の 「Maira 提供」 vs 「各エージェント が 自分で 作る」 → 後者 だと 設定 重い、 前者 だと 信頼性高い
2. LINE 公式アカウント の 「認証済アカウント」 でない と 一斉配信 数 制限 が 厳しい
3. 求職者 が 複数 エージェント の LINE と 友達 の 場合 の Maira 側 表示 (現状 各 org で 独立)
4. 規約 / 同意取得 の UI フロー (プライバシーポリシー 改定 と 連動)
