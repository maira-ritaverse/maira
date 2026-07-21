# LINE WORKS 連携 設計書(2026-07)

> ステータス: **設計ドラフト(実装未着手)**。本書は方針合意用。実装前に本書の
> 「要確認事項」を潰し、Phase 単位でユーザー承認を得てから着手する。
>
> 決定済みの前提(ユーザー確認済み):
>
> - 用途: **(A) 社内共有連携(アドバイザー向けの通知・チーム共有)に集中する。**
>   **(B) 候補者コミュニケーションは対象外(第2章の技術制約により延期)。**
> - **(C) LINE WORKS カレンダー連携(面談スケジュールの同期)を対象に追加。**
> - 接続単位: **エージェント組織ごと(マルチテナント)**。既存の LINE 公式アカウント連携と同じ流儀
> - 導入は **各エージェント企業のオプトイン(任意)**。設定画面で接続したい会社だけが有効化する
>   (既存 LINE 連携と同じ。未接続組織は一切影響を受けない)。
>
> 設計判断(確定 2026-07):
>
> 1. 社内共有の宛先: **担当者個人への DM + チーム共有チャンネルへの投稿の両方**に対応。
> 2. カレンダーの外部イベント ID: **中間テーブル `meeting_external_syncs` を新設**(既存の
>    Google 同期の未保存問題も同時に解消)。
> 3. 同期の実装: 散在する 4 箇所を **集約レイヤー `lib/meetings/external-sync.ts` に一元化**。

> 【スコープ改定 2026-07】当初「候補者コミュニケーションも含む両用途」だったが、
> ユーザー判断で **社内共有連携 + カレンダー連携** に絞る。第10章(用途B)・
> 第11章(MA)は **対象外(将来検討)** として残す。カレンダー連携の詳細は
> 下記『11.5 用途C: LINE WORKS カレンダー連携』章を参照。

---

## 0. 用語と対象の明確化(最重要)

**LINE WORKS は、Maira が既に連携している「LINE 公式アカウント(Messaging API)」とは別製品**である。

|              | LINE 公式アカウント(既存)                 | LINE WORKS(本書)                                             |
| ------------ | ----------------------------------------- | ------------------------------------------------------------ |
| 位置づけ     | 消費者向けチャットの企業アカウント        | 企業向けグループウェア(Slack/Teams 相当)                     |
| 主な相手     | 一般 LINE ユーザー(求職者)                | 社内メンバー + テナントのチャンネル/外部ユーザー             |
| API          | Messaging API(`api.line.me`)              | LINE WORKS API 2.0(`worksapis.com` / `auth.worksmobile.com`) |
| 認証         | 長期固定の Channel Access Token(手動入力) | **Service Account の JWT → 短命アクセストークン発行**        |
| Webhook 署名 | `X-Line-Signature`(HMAC-SHA256/base64)    | `X-WORKS-Signature`(HMAC-SHA256/base64、鍵は Bot Secret)     |

この差(特に認証)が設計上の最大の分岐点。既存 LINE 連携のファイル/テーブルを雛形にしつつ、**トークン発行・キャッシュ層**を新設する。

---

## 1. LINE WORKS API 2.0 の要点

> **公式照合済み(2026-07, developers.worksmobile.com)。** 主要仕様は確認済みで本節に反映。
> 認証ホスト `auth.worksmobile.com` と API ホスト `www.worksapis.com` を混同しないこと。
> 残る未確認項目のみ第15章に列挙。

### 1.1 アプリ登録(Developer Console)

エージェント各社が LINE WORKS Developer Console で「アプリ」を作成し、以下を取得:

- **Client ID / Client Secret**(アプリ資格情報)
- **Service Account**(サーバ間認証の主体)
- **Private Key**(RSA 秘密鍵。JWT 署名用)
- **Bot**(Bot ID / Bot Secret。メッセージ送受信・Callback 署名鍵)
- **Domain ID**(テナント識別)

### 1.2 認証(Service Account, JWT Bearer)

1. JWT を生成: `header={alg:RS256,typ:JWT}`, `payload={iss:ClientID, sub:ServiceAccount, iat, exp(最大1h)}`, Private Key で RS256 署名。
2. トークン発行: `POST https://auth.worksmobile.com/oauth2/v2.0/token`
   - `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`
   - `assertion={JWT}` / `client_id` / `client_secret` / `scope=bot,bot.message,directory.read,calendar`(**カンマ区切り**、用途に応じ)
   - 応答: `access_token` / `refresh_token` / `expires_in` / `scope`。有効期限は Console 設定で **1h または 24h**。API 呼出は `Authorization: Bearer {token}`
3. 更新: `grant_type=refresh_token`。

→ **アクセストークンは短命**。「復号した資格情報 → JWT 生成 → トークン発行 → キャッシュ」の層が必須(既存 LINE の「復号した固定トークンをそのまま返す」構造とは異なる)。

### 1.3 Bot API(送信)

- ユーザー宛: `POST https://www.worksapis.com/v1.0/bots/{botId}/users/{userId}/messages`
- チャンネル宛: `POST .../bots/{botId}/channels/{channelId}/messages`
- Body 例: `{ "content": { "type": "text", "text": "..." } }`。他に `button_template` / `list_template` / `carousel` / `flex` / `image` / `link` / `stamp` / `file`。
- Header: `Authorization: Bearer {accessToken}`, `Content-Type: application/json`。

### 1.4 Callback(受信 = Webhook)

- Bot ごとに Callback URL を登録。イベント `message`/`join`/`leave`/`joined`/`left`/`postback` が JSON で POST される。
- 署名 `X-WORKS-Signature` = `base64(HMAC-SHA256(BotSecret, rawBody))` を検証。
- `source.{userId, channelId, domainId}` で送信元を識別。

### 1.5 Directory API(社内通知のメンバー解決)

- `GET https://www.worksapis.com/v1.0/users`(scope `directory.read`)でメンバー一覧。
- アドバイザーの **メールアドレス → LINE WORKS userId** をマッピングするのに使う(用途A で必須)。

---

## 2. 技術的制約 — 候補者コミュニケーションの現実(正直に)

**LINE WORKS Bot API は基本「テナント内のメンバー / チャンネル」への送受信**を想定している。**一般の消費者 LINE ユーザー(=多くの求職者)へ Bot API で任意に送信することはできない。**

候補者(求職者)に LINE WORKS で到達する経路と実現性:

| 経路                                                                                        | 実現性               | 備考                                                                |
| ------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------- |
| 求職者が LINE WORKS の**外部ユーザー/ゲスト**として招待済み(Bot と同一チャンネル or 連絡先) | △ 可能だが運用が重い | 候補者ごとに招待・受諾が必要。Bot がそのチャンネル/ユーザーに送信可 |
| 求職者が普通の**消費者 LINE**利用(一般的)                                                   | ✗ Bot API 不可       | LINE WORKS「外部トーク連携」は**手動 UI 機能**で API 送信対象外     |
| **公式 LINE(既存連携)で送る**                                                               | ◎                    | 消費者 LINE への到達はこちらが本来のツール                          |

**結論・推奨:**

- **消費者 LINE の求職者との会話は、引き続き既存の「LINE 公式アカウント連携」が主チャネル**。LINE WORKS で置き換えるものではない。
- LINE WORKS の候補者コミュニケーションは、**「候補者が当該エージェントの LINE WORKS に外部ユーザー/ゲストとして参加している」ケースに限定して**設計する(下記 用途B)。この前提が成り立たない組織では用途B は無効化し、用途A(社内通知)のみ有効にできるようにする。
- したがって実装は **用途A を Phase 1(確実な価値)**、**用途B を Phase 2(前提確認後)** とする。

---

## 3. アーキテクチャ全体像(既存 LINE の流儀を踏襲)

```
Developer Console(各社)         Maira(サーバ)                       Supabase
  ┌ Client ID/Secret            ┌ 設定UI /settings/integrations/lineworks   ┌ lineworks_channels(暗号化資格情報)
  ├ Service Account+PrivateKey → │  POST /api/agency/lineworks/channel  → │  (org=1row, RLS: SELECT自orgのみ)
  ├ Bot(BotId/Secret)          │                                       │
  └ Callback URL 登録 ←──────────┤ /api/webhooks/lineworks/[token]  ←── LINE WORKS Callback
                                 │   ├ 署名検証(X-WORKS-Signature)         ┌ lineworks_user_links(外部/社内ユーザー紐付け)
                                 │   └ event-handler ──────────────────→ │  lineworks_messages(暗号化ログ)
        送信 ←──── worksapis.com ← │ lib/lineworks/api.ts(要 access token) │
                                 │   ↑ lib/lineworks/token.ts(JWT→発行→cache)
        通知 fan-out ────────────→ │ 既存 notification 経路 + LINE WORKS push(用途A)
        MA/配信 ─────────────────→ │ ma_* の channel 抽象に 'lineworks' 追加(用途B)
```

**再利用する既存基盤(拡張不要):**

- `lib/crypto/field-encryption.ts`(`encryptField`/`decryptField`, AES-256-GCM)— 資格情報・秘密鍵・本文の暗号化に共用
- `lib/api/auth-guards.ts`(`requireOrgAdmin`/`requireOrgMember`)、`lib/supabase/service.ts`(`createServiceClient`)、`lib/api/cron-auth.ts`
- RLS 関数 `current_user_organization_id()`、`organization_id` スコープの張り方

**雛形にする既存実装:**

- 認証情報保管/接続: `lib/line/queries.ts` + `line_channels` + `app/(agency)/agency/settings/integrations/line/*`
- Webhook: `app/api/webhooks/line/[webhookToken]/route.ts` + `lib/line/signature.ts` + `lib/line/event-handler.ts`
- 送信抽象: `lib/line/api.ts` + `lib/line/messaging.ts`
- **トークン発行・キャッシュ**: `lib/integrations/zoom-token.ts` / `lib/integrations/google-token.ts`(OAuth 短命トークンの発行・更新の既存パターン)

---

## 4. データモデル(新規テーブル)

新規マイグレーション 1 本 `supabase/migrations/YYYYMMDDNNNNNN_add_lineworks_integration.sql`。RLS は既存流儀=**SELECT のみ `organization_id = current_user_organization_id()`、INSERT/UPDATE/DELETE ポリシーは作らず service_role 経由のみ**。

### 4.1 `lineworks_channels`(1 org = 1 row)

| カラム                           | 型                      | 暗号化 | 用途                                       |
| -------------------------------- | ----------------------- | ------ | ------------------------------------------ |
| `organization_id`                | uuid PK → organizations |        | テナント                                   |
| `domain_id`                      | text                    | 平文   | LINE WORKS テナント識別                    |
| `client_id`                      | text                    | 平文   | アプリ Client ID                           |
| `client_secret_encrypted`        | text                    | ●      | Client Secret                              |
| `service_account`                | text                    | 平文   | Service Account ID                         |
| `private_key_encrypted`          | text                    | ●      | JWT 署名用 RSA 秘密鍵                      |
| `bot_id`                         | text                    | 平文   | Bot ID                                     |
| `bot_secret_encrypted`           | text                    | ●      | Callback 署名検証鍵                        |
| `webhook_token`                  | text UNIQUE             |        | Callback URL に埋める推測困難トークン      |
| `scopes`                         | text                    | 平文   | 発行時に要求するスコープ                   |
| `notify_enabled`                 | bool                    |        | 用途A(社内通知)の ON/OFF                   |
| `share_channel_id`               | text                    | 平文   | 用途A のチーム共有チャンネル ID(任意)      |
| `calendar_sync_enabled`          | bool                    |        | 用途C(カレンダー同期)の ON/OFF             |
| `candidate_channel_enabled`      | bool                    |        | 用途B(候補者、対象外)の ON/OFF(既定 false) |
| `is_active` / `last_verified_at` |                         |        | 接続状態                                   |

- **access token / refresh token のキャッシュ**は別テーブル or 同テーブルの `access_token_encrypted` + `access_token_expires_at` + `refresh_token_encrypted` に保持(Zoom 連携と同様)。短命なのでメモリキャッシュ + DB フォールバックの二層。

### 4.2 `lineworks_user_links`(相手ユーザーの紐付け)

`line_user_links` と同型。1 org × 1 `lineworks_user_id` で unique。

- `organization_id`, `lineworks_user_id`(平文), `channel_id`(グループ宛の場合), `kind ∈ {member, external, channel}`(社内メンバー / 外部候補者 / チャンネル)
- **用途A**: `member_user_id`(Maira の profiles.id)へのマッピング(アドバイザー ↔ LINE WORKS メンバー)
- **用途B**: `client_record_id`(NULL=未紐付け)、`display_name` 等
- `handled_at` / `last_activity_at` / `unfollowed_at`(既存 line_user_links の後続追加分に相当)

### 4.3 `lineworks_messages`(送受信ログ)

`line_messages` と同型。`encrypted_content`(暗号化本文)、`direction ∈ {inbound, outbound}`、`send_status ∈ {queued, sent, failed}`、`send_method ∈ {user, channel}`、`unique(organization_id, lineworks_message_id)` で冪等。

---

## 5. 認証情報の保管と接続フロー

設定 UI: `app/(agency)/agency/settings/integrations/lineworks/*`(`line/*` 一式を雛形にコピー、admin 限定)。

接続手順(手動入力、既存 LINE と同じ思想):

1. エージェント管理者が Developer Console で App/Bot を作成
2. Maira の設定画面に Client ID / Client Secret / Service Account / Private Key / Bot ID / Bot Secret / Domain ID を入力 → `POST /api/agency/lineworks/channel`
3. サーバ側で **JWT 生成 → トークン発行を実際に試行**して資格情報の有効性を検証(既存 LINE の `getBotInfo()` 検証に相当)
4. 成功したら `encryptField` で機密を暗号化して `lineworks_channels` に upsert、`webhook_token` を生成し **Callback URL を画面に表示**(LINE WORKS の Callback 登録は Console 側手動、または API があれば自動 PUT)
5. 機密は保存後フォームから即クリア・再表示しない

秘密鍵(RSA)は特に機微。**暗号化必須**、ログ出力厳禁、ブラウザに戻さない。

---

## 6. トークン発行・キャッシュ層(`lib/lineworks/token.ts`)— 最大の新規要素

```
getLineworksAccessToken(orgId):
  1. lineworks_channels を復号取得(client_id/secret, service_account, private_key, scopes)
  2. キャッシュ(メモリ→DB access_token_expires_at)が有効ならそれを返す
  3. 無効なら:
       a. refresh_token があれば grant_type=refresh_token で更新
       b. 無ければ JWT(RS256, iss=client_id, sub=service_account, exp≤1h)を生成し
          jwt-bearer でトークン発行
  4. 新 access_token/refresh_token/expires_at を暗号化して DB 更新 + メモリキャッシュ
  5. access_token を返す
```

- JWT の RS256 署名は Web Crypto API(`crypto.subtle.importKey(pkcs8) → sign`)で実装(外部ライブラリ禁止方針に沿う。既存が Edge 対応の raw fetch 志向なのと整合)。
- 同時多発リクエストの二重発行を避けるため org 単位の in-flight Promise を共有(single-flight)。

---

## 7. Webhook 受信(`app/api/webhooks/lineworks/[webhookToken]/route.ts`)

既存 LINE の流儀を踏襲:

1. `request.text()` で生 body 取得
2. `webhook_token → org` 解決(`getLineworksChannelByWebhookToken`、復号、`is_active` 確認、判別可能ユニオンで状態別ログ)
3. `verifyWorksSignature(rawBody, X-WORKS-Signature, botSecret)`(`lib/lineworks/signature.ts`、`timingSafeEqual`)
4. JSON parse → 各 event を `handleLineworksEvent()` に dispatch(`Promise.all` + 個別 try/catch)
5. **常に 200 を返す**

イベント処理(`lib/lineworks/event-handler.ts`):

- `message`: `ensureLineworksUserLink()` → `lineworks_messages` に冪等 upsert → 用途B なら `notifyAgencyOfLineworksMessage`(担当者へ fan-out)。連携コードによる client 紐付けも LINE と同様に実装可能。
- `join`/`leave`/`joined`/`left`: メンバー/外部ユーザーの参加離脱を link 行に反映
- `postback`: 会議提案などの postback を LINE 版と同様に処理(将来)

---

## 8. メッセージ送信抽象(`lib/lineworks/api.ts` + `messaging.ts`)

- `lib/lineworks/api.ts`: `lib/line/api.ts` を雛形に、基底 `WORKS_API_BASE="https://www.worksapis.com/v1.0"`。関数は `sendUserMessage(accessToken, botId, userId, content)` / `sendChannelMessage(accessToken, botId, channelId, content)` / `getBotInfo` 等。**第1引数は毎回 `getLineworksAccessToken(orgId)` で取得した短命トークン**。throw せず `Result<T>` 型。
- `lib/lineworks/messaging.ts`: 送信前に `lineworks_messages` へ `queued` で暗号化 INSERT → 送信 → `sent`/`failed` 更新。LINE WORKS には reply_token の概念が無い(常に push 相当)ので、LINE 版の reply/push 自動切替は不要=シンプル化。`classifyLineworksError()` で unauthorized/quota/blocked を分類。

---

## 9. 用途A: 社内通知(アドバイザー向け)

**目的:** Maira のアラートを担当者の LINE WORKS に push。既存のメール/アプリ内通知の補完。

対象アラート(既存の通知源をそのまま流用):

- Daily ダイジェスト(`lib/agency/daily-digest.ts`)
- 沈黙アラート(`app/api/internal/line/stale-alerts` 相当のロジック)
- 新着 LINE メッセージ(`notifyAgencyOfLineMessage`)
- 期限/タスク・面談リマインド(`app/api/internal/tasks|meetings/reminders`)

**設計:**

1. **メンバー・マッピング**: Directory API で LINE WORKS メンバーを取得し、`profiles.email`(または表示名)と突き合わせて `lineworks_user_links(kind='member', member_user_id, lineworks_user_id)` を作る。設定画面に「メンバー照合」ボタンを置く。
2. **個人 DM 通知**: 既存の通知送出点(`lib/notifications/*`、daily-digest の送信部)に「LINE WORKS 送信」チャネルを追加。通知設定(`lib/notifications/prefs.ts`)に `lineworks_enabled` キーを足し、ON のメンバーには `sendUserMessage(bot, memberLineworksUserId, ...)` で push。
3. **チーム共有チャンネル投稿**: 組織が指定した LINE WORKS チャンネル(`lineworks_channels.share_channel_id`)へ `sendChannelMessage(bot, channelId, ...)` で共有投稿(新着候補者・日次サマリ・成約報告 等)。個人 DM と併用。設定画面でチャンネルを選択/入力。
4. **文面**: 通知種別ごとに LINE WORKS 用テンプレ(text + list_template でリンク付き)。

用途A は **消費者 LINE の制約と無関係**でクリーンに実装できる = **Phase 1 の中心**。

---

## 10. 用途B: 候補者コミュニケーション(**対象外・将来検討**)

> スコープ改定により当面**対象外**。第2章の技術制約(消費者 LINE の求職者へは
> Bot API で送れない)があり、消費者 LINE の会話は既存の公式 LINE 連携で継続する。
> 以下は将来検討用に残す。

第2章の制約により、**「候補者が当該エージェントの LINE WORKS に外部ユーザー/ゲストとして存在する」場合のみ**有効化(`candidate_channel_enabled`)。

- 会話 UI・履歴一元管理は既存 LINE の会話画面(`app/(agency)/agency/line/(conversations)/*`)を雛形に、`lineworks_user_links(kind='external')` の相手と `lineworks_messages` を表示。
- 送信は `sendUserMessage`/`sendChannelMessage`。
- **公式 LINE を置き換えない**。UI 上は「チャネル: LINE / LINE WORKS」を明示し、消費者 LINE の求職者は従来どおり公式 LINE で扱う。

用途B は前提確認(候補者をどう LINE WORKS に載せるか)が済んでから **Phase 2** で着手。

---

## 11. MA/配信層のチャネル抽象化(**対象外・将来検討**)

> 用途B(候補者への配信)に紐づくため当面**対象外**。将来検討用に残す。

既存 MA は `ma_scenarios.channel` 列を既に持つ(チャネル非依存基盤に LINE を後付けした設計)。

- 送信部分(`lib/ma/flow-executor.ts` の `sendLineStep` 等、`broadcasts-dispatch`)を **channel 別に分岐**させ、`channel='lineworks'` のとき `getLineworksAccessToken` + LINE WORKS push を呼ぶ。
- `ma_send_logs` に `recipient_lineworks_user_id` 列を追加(既存 `recipient_line_user_id` に倣う)。
- 用途B が有効な組織のみ LINE WORKS 配信を許可。

これは Phase 2 以降(用途B が動いてから)。

---

## 11.5 用途C: LINE WORKS カレンダー連携(面談スケジュール同期)★今回追加

**目的:** Maira の面談スケジュール(`meeting_schedules`)を、担当アドバイザーの
LINE WORKS カレンダーに同期(作成/更新/キャンセル)。社内共有の一環として、面談予定が
LINE WORKS 上でも見えるようにする。

### 11.5.1 認証の共用(設計上の妙 = Google より単純)

LINE WORKS はテナントの **Service Account が Calendar スコープ(`calendar`)を持てば、
Directory で解決した各メンバーの userId のカレンダーにイベントを作成できる**(管理者権限)。
→ **用途A と同じ org 単位の `lineworks_channels`(Service Account トークン層)を、
カレンダーにもそのまま流用**する。Google のような **per-user OAuth 接続
(`google_connections`)は不要**。これが LINE WORKS カレンダーが Google 同期より単純になる点。

> 対比: 既存の Google カレンダー同期は `google_connections`(user_id スコープ、
> 個人 OAuth)。LINE WORKS は org の Service Account 1 つで全メンバーのカレンダーを
> 書けるため、接続は org スコープ(`lineworks_channels`)に一本化する。

### 11.5.2 LINE WORKS Calendar API 要点

- スコープ: `calendar`(書込)/ `calendar.read`(参照)。
- ユーザーカレンダーにイベント作成: `POST https://www.worksapis.com/v1.0/users/{userId}/calendar/events`
  (共有カレンダーなら `/calendars/{calendarId}/events`)。
- Body は **`eventComponents[]` の構造化フィールド**(iCal 生文字列ではない)+ `sendNotification`:
  ```json
  {
    "eventComponents": [
      {
        "summary": "面談",
        "description": "...",
        "location": "...",
        "start": { "dateTime": "2026-07-21T10:00:00", "timeZone": "Asia/Tokyo" },
        "end": { "dateTime": "2026-07-21T11:00:00", "timeZone": "Asia/Tokyo" }
      }
    ],
    "sendNotification": true
  }
  ```
  返却の `eventId` を `meeting_external_syncs.external_event_id` に保存し、後で update/delete に使う。
- 更新: `PUT .../users/{userId}/calendars/{calendarId}/events/{eventId}`
- 削除: `DELETE .../users/{userId}/calendars/{calendarId}/events/{eventId}`(作成は
  `.../users/{userId}/calendar/events`。更新/削除は返却された `organizerCalendarId` を calendarId に使う)

### 11.5.3 対象ユーザーの解決

面談の `host_user_id`(担当アドバイザー)→ `lineworks_user_links(kind='member',
member_user_id → lineworks_user_id)` で LINE WORKS userId に解決(**用途A のメンバー
照合を共用**)。招待者(求職者)は LINE WORKS メンバーでないため attendee には入れず、
description に氏名・連絡先を記載する。

### 11.5.4 外部イベント ID の保持(既存スキーマ課題も同時解消)

現状 `meeting_schedules` には Google Calendar 用のイベント ID 保持カラムすら無く、
Zoom 予約時の Google 副次イベントは fire-and-forget(更新/削除不可)。LINE WORKS を
足すにあたり、**正規化した中間テーブル `meeting_external_syncs` を新設する(確定)**:

```sql
meeting_external_syncs(
  id uuid pk,
  meeting_schedule_id uuid → meeting_schedules(id) on delete cascade,
  target text check (target in ('google_calendar','lineworks_calendar')),
  external_event_id text,            -- 各カレンダーのイベントID
  sync_status text check (sync_status in ('synced','failed','deleted')),
  last_synced_at timestamptz, error text,
  created_at, updated_at,
  unique(meeting_schedule_id, target)
)
```

これで「同期先ごとの外部イベント ID」を一元管理でき、Zoom→Google の未保存問題も同時に解消。
RLS は既存流儀(SELECT=同 org、書込=service_role)。
※ 最小実装なら `meeting_schedules` に `lineworks_calendar_event_id` 1 カラム追加でも可
(ただし将来の同期先追加で再び散らかるため中間テーブルを推奨)。

### 11.5.5 同期の発火点 — 同期レイヤーを新設して集約(推奨)

現状、外部カレンダー同期は**集約レイヤーが無く 4 箇所に散在**:

| 局面                   | ファイル                                             |
| ---------------------- | ---------------------------------------------------- |
| 作成(クライアント詳細) | `app/api/agency/meetings/route.ts` POST              |
| 更新/キャンセル        | `app/api/agency/meetings/[id]/route.ts` PATCH/DELETE |
| LINE postback 確定     | `lib/line/event-handler.ts` `confirmMeetingProposal` |
| LINE キャンセル        | `app/api/agency/line/cancel-meeting/route.ts`        |

**この機に同期レイヤー `lib/meetings/external-sync.ts` を新設(確定)**し、
`syncMeetingToExternalCalendars(meeting, action)`(action = created/updated/canceled)に集約する。
Google の副次同期もここへ寄せ、`meeting_external_syncs` を更新する。LINE WORKS カレンダーは
その同期先の 1 つとして `lib/integrations/lineworks-calendar.ts` を呼ぶ。
→ 4 箇所は各々「同期レイヤーを 1 行呼ぶ」だけになり、今後の同期先追加が容易。
(最小変更に留めるなら、4 箇所に LINE WORKS 分岐をインライン追加も可だが散在が悪化する)

### 11.5.6 同期の条件・方向

- 条件: 組織が LINE WORKS 接続済 + `lineworks_channels.calendar_sync_enabled` + host が
  LINE WORKS メンバーに紐付け済。未接続/未紐付けはスキップ(`meeting_external_syncs` に
  `failed` を残して可視化するのが望ましい)。
- 方向: **outbound(Maira → LINE WORKS)のみ**を基本とする。面談は Maira 発が前提で、
  カレンダー画面(`calendar-view.tsx`)は既に `meeting_schedules` を主データ源にしているため、
  Maira 側表示の追加は不要。LINE WORKS 側で作られた予定を Maira に取り込む(inbound)必要が
  あるかは要確認(通常は不要)。

## 12. セキュリティ

- **秘密鍵(RSA)・Client Secret・Bot Secret・アクセストークン**はすべて `encrypted_*` で AES-256-GCM 暗号化。平文を DB/ログ/ブラウザに出さない(CLAUDE.md 暗号化ルール準拠)。
- Webhook は `X-WORKS-Signature` を `timingSafeEqual` で検証。生 body で検証。
- RLS: 全新規テーブル SELECT-only org スコープ、書込は service_role 経由(既存 LINE と同一流儀)。API ハンドラで `requireOrgAdmin`/`requireOrgMember`。
- トークン発行の single-flight で二重発行/レース回避。
- 用途B の候補者データは既存の暗号化方針(会話本文=`encrypted_content`)を踏襲。

---

## 13. 段階的実装プラン

| Phase                                   | 内容                                                                                                                                                             | 主な成果物                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **0. 事前確認**                         | LINE WORKS プラン/API権限・Developer Console 設定・課金前提の確認、公式ドキュメントで API 仕様(Bot / Directory / **Calendar**)確定                               | 要確認事項の解消                                 |
| **1. 接続基盤 + トークン層**            | `lineworks_channels` マイグレーション、`lib/lineworks/{token,api,queries}.ts`、設定 UI、接続検証                                                                 | 組織が LINE WORKS を接続でき、トークン発行が回る |
| **2. Webhook + Directory メンバー照合** | `/api/webhooks/lineworks/[token]`、`signature.ts`、`event-handler.ts`、`lineworks_messages/_user_links`、アドバイザー↔userId 照合                                | inbound 受信・メンバー解決                       |
| **3. 用途A 社内共有(通知/チーム共有)**  | 通知 prefs 拡張、各アラート(Daily ダイジェスト/沈黙/新着/期限)の LINE WORKS 送出(個人 DM / チームチャンネル)                                                     | アドバイザー・チームへ push 共有                 |
| **4. 用途C カレンダー連携**             | `meeting_external_syncs`(or 列追加)、`lib/integrations/lineworks-calendar.ts`、同期レイヤー `lib/meetings/external-sync.ts`、面談 作成/更新/キャンセルの同期発火 | 面談が LINE WORKS カレンダーに同期               |
| ~~用途B 候補者チャネル / MA 配信~~      | **対象外(将来検討)**                                                                                                                                             | ―                                                |

各 Phase 着手前に差分計画を提示し承認を得る(CLAUDE.md 準拠)。DB スキーマ変更は maira-dev のみ適用 → 本番は明示指示時。

---

## 14. コスト・前提(要注意 / CLAUDE.md「月額コスト発生」ルール)

- **LINE WORKS 自体は各エージェント企業の契約**(無料プラン/有料プランあり)。API・Bot・Directory の利用可否と上限はプラン依存。Maira 側の追加月額コストは基本発生しないが、**エージェントに LINE WORKS 契約が前提**。
- Anthropic/Resend のような Maira 直課金は本連携では発生しない見込み。ただし API レート制限・送信上限はプランに従う。

---

## 15. 要確認事項(実装前に潰す)

1. **候補者の LINE WORKS 参加形態**: 用途B の対象組織で、求職者は LINE WORKS に外部ユーザー/ゲストとして載るのか、それとも消費者 LINE のままか(後者なら用途B は無効・公式 LINE で継続)。
2. **API 仕様の最終確認**: ✅ 済(2026-07 公式照合)。認証=`auth.worksmobile.com/oauth2/v2.0/token`(JWT RS256, exp≤iat+60分, grant_type=jwt-bearer, scope カンマ区切り)、Bot 送信=`www.worksapis.com/v1.0/bots/{botId}/users|channels/{id}/messages`(`{content:{...}}`, 201)、署名=`X-WORKS-Signature`=Base64(HMAC-SHA256(BotSecret, rawBody))、Calendar=`eventComponents[]` 形式。**残る未確認**(実装時に個別確認): refresh_token 更新の厳密パラメータ、carousel の JSON 詳細、leave/joined/left の完全形、メール→userId のメール検索専用 API の有無(現状は一覧取得して email 突合)、API 1.0 の正確な停止日。
3. **Callback URL 登録の自動化可否**: Console 手動か、API で PUT 可能か。
4. **Directory 参照権限**: 用途A のメンバー照合に必要なスコープ/管理者同意の要否。
5. **秘密鍵の入力 UX**: PEM 貼り付けを想定。フォーマット検証と暗号化保存の手順確定。
6. **RS256 署名の実装**: Web Crypto での PKCS8 秘密鍵取り込み・署名の実機確認。

---

## 16. 新規/変更ファイル一覧(実装時の見取り図)

**新規:**

- `supabase/migrations/*_add_lineworks_integration.sql`(`lineworks_channels`/`_user_links`/`_messages` + RLS)
- `supabase/migrations/*_add_meeting_external_syncs.sql`(カレンダー同期の外部イベントID一元管理)★用途C
- `lib/lineworks/token.ts`(JWT 生成・トークン発行/キャッシュ)★新規要素
- `lib/lineworks/api.ts` / `messaging.ts` / `signature.ts` / `event-handler.ts` / `queries.ts` / `errors.ts`
- `lib/integrations/lineworks-calendar.ts`(Calendar API create/update/delete/list)★用途C
- `lib/meetings/external-sync.ts`(外部カレンダー同期の集約レイヤー。Google 副次同期もここへ寄せる)★用途C
- `app/api/webhooks/lineworks/[webhookToken]/route.ts`
- `app/api/agency/lineworks/channel/{route,verify,setup}/route.ts`
- `app/(agency)/agency/settings/integrations/lineworks/*`(設定 UI 一式)
- (用途A)通知送出の LINE WORKS チャネル、Directory 照合 API

**拡張:**

- `lib/notifications/prefs.ts`(`lineworks_enabled` キー)+ 通知送出点(用途A)
- 面談 作成/更新/キャンセルの 4 ルートを `external-sync.ts` 呼び出しに置換(用途C):
  `app/api/agency/meetings/route.ts` / `[id]/route.ts`、`lib/line/event-handler.ts` の
  `confirmMeetingProposal`、`app/api/agency/line/cancel-meeting/route.ts`

**将来(対象外):**

- `lib/ma/flow-executor.ts` ほか配信層の channel 分岐、`ma_send_logs` に `recipient_lineworks_user_id`(用途B/MA)
