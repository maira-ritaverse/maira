# 管理者(admin)ガイド

管理者(admin)権限のメンバーが行う組織運営・連携設定・課金・メンバー管理を網羅します。
通常のエージェント業務は「エージェント向けマニュアル」を参照してください。

## 役割の違い

| 役割                  | 主な権限                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------- |
| admin(管理者)         | メンバー招待・権限変更、組織情報編集、連携設定、課金、AI 利用状況閲覧、推薦文テンプレ編集 |
| advisor(アドバイザー) | 担当顧客の操作、自分のタスク管理、LINE 対応、書類作成等の日常業務                         |

最後の admin を advisor に降格しようとするとサーバー側で必ず拒否されます(組織が admin 不在になることを防ぐ)。

## 初期セットアップ(導入時の流れ)

### Step 1: 組織アカウントの作成

1. `https://www.maira.pro/signup` で組織管理者としてサインアップ
2. メール確認 → ログイン
3. 組織名を入力(後から変更可能)

### Step 2: メンバー招待

`/agency/members` から:

1. 「メンバーを招待する」ボタン
2. メールアドレスと初期役割(admin / advisor)を指定
3. 招待メールが送信される
4. 招待メールのリンクから招待者がサインアップ → 自動で組織に参加

### Step 3: 公式 LINE 連携(必要な場合)

`/agency/line/settings` で:

1. LINE Developers Console で Messaging API チャネルを作成
2. Channel ID / Channel Secret / Channel Access Token を Maira に保存
3. Maira が生成した Webhook URL を LINE Developers に登録
4. Webhook 検証(「Verify」ボタン)で疎通確認
5. 友達追加時の自動メッセージ・Rich Menu 等を設定

### Step 4: 会議連携

#### Zoom

1. `/agency/settings/integrations` → 「Zoom アカウントを連携する」
2. OAuth 認可フローで Zoom にログイン
3. meeting:write スコープを許可
4. 完了

#### Google(カレンダー + Meet)

1. 同画面で「Google アカウントを連携する」
2. OAuth 認可で calendar.events スコープを許可
3. 完了

注: Google OAuth アプリが「テスト中」ステータスの場合、テストユーザーに登録されたアカウントのみ連携可能。本番公開申請後は誰でも可能。

### Step 5: メール送信設定(オプション)

Resend 連携が組織で必要な場合は、運営側で `RESEND_API_KEY` 等を設定済(基本的に管理者の操作は不要)。

### Step 6: 推薦文テンプレート

`/agency/settings/recommendation-letter-templates`:

- 冒頭挨拶 / 末尾定型句を組織共通で登録
- AI 推薦文生成時に自動適用される

## メンバー管理(/agency/members)

### メンバー一覧

- 名前(アバター付き)・メール・権限・ロール を表示
- admin → 全権限自動、advisor は個別に権限フラグを ON/OFF

### 権限フラグ(advisor 向け)

- **export**: CSV エクスポート
- **billing**: 課金情報の閲覧
- 等

admin は自動的に全権限を持つため、フラグ編集は advisor のみ。

### ロール変更

- ドロップダウンから admin ↔ advisor
- 自分自身を降格する場合は警告ダイアログ
- 最後の admin の降格はサーバー側で拒否

### メンバー削除

- 「削除」ボタンで organization_members レコードを削除
- ユーザー自体(profiles + auth.users)は残る
- 担当していたクライアントは未割当に戻る

### 監査ログ

メンバー操作の履歴は `member_audit_log` に記録されます。

## 課金プラン(/agency/settings/billing)

admin のみアクセス可能。

### 現在のプラン情報

- プラン名
- 無料期間の残日数
- 次回請求日

### プラン変更

- Stripe Customer Portal にリダイレクトしてプラン変更
- アップグレード / ダウングレード / 解約が可能

### アドオン

- **会議録音自動取込アドオン**(meeting_recording_auto): 月 50 件まで AI 処理

### トライアル期限通知

- トライアル終了 7 日前 / 3 日前 / 当日にメール通知(運営側 cron)

## AI 利用状況(/agency/settings/ai-usage)

admin のみアクセス可能。

### 今月の AI 利用残数

- 組織全体の月次合計枠(プラットフォーム上限)
- 機能別の使用回数 + 残数
- メンバー別の使用内訳

### 機能別の AI 種別

| kind                                 | 説明                            | スコープ   |
| ------------------------------------ | ------------------------------- | ---------- |
| job_recommendation_agency            | AI 推薦(エージェント側から実行) | 組織横断   |
| recommendation_letter_draft          | 推薦文 AI 下書き                | 組織横断   |
| agency_cv_draft                      | 職務経歴書 AI 下書き            | 組織横断   |
| agency_resume_draft                  | 履歴書 AI 下書き                | 組織横断   |
| job_extract_from_document            | 求人 PDF/画像 抽出              | 組織横断   |
| csv_column_mapping                   | CSV 列マッピング                | 組織横断   |
| agency_recording_processed           | 録音 → AI 処理                  | 組織横断   |
| agency_client_summary                | クライアント状況サマリー        | 組織横断   |
| photo_enhance                        | AI 証明写真                     | 求職者個人 |
| job_recommendation_seeker            | AI 推薦(求職者側)               | 求職者個人 |
| seeker_resume_create / cv_create     | 求職者の書類作成                | 求職者個人 |
| seeker_resume_ai_draft / cv_ai_draft | 求職者の AI 下書き              | 求職者個人 |

### 月次トレンド

過去 6 ヶ月の利用量グラフ + 概算コスト(USD)。

### 利用上限のカスタマイズ

機能ごとに月次上限を組織で個別設定可能(プラン上限内)。

## 通知設定の組織方針

各メンバーが個別に通知 ON/OFF を持ちますが、admin として推奨する設定:

- **email_enabled**: ON(マスタースイッチ)
- **daily_digest**: 全 admin に ON 推奨(朝の運用習慣化)
- **line_message_received**: 営業時間中だけ ON にしたい場合は時間外を OFF に

## Slack 連携(オプション)

`/agency/members` の slack settings セクションから:

- Slack Incoming Webhook URL を組織で 1 つ登録
- 求職者「興味あり」「応募依頼」時に組織 Slack に通知
- LINE 新着 もオプションで通知

## データ保護とプライバシー

### 暗号化対象フィールド

以下の列は AES-256-GCM でサーバー側暗号化:

- 会話履歴(messages.encrypted_content)
- キャリア棚卸し結果(career_profiles.encrypted_data)
- 応募情報(applications.encrypted_details)
- タスク内容(agency_tasks.encrypted_title, encrypted_description)
- 通知ペイロード(notifications.encrypted_payload)
- 会話タイトル(conversations.encrypted_title)
- LINE メッセージ(line_messages.encrypted_content)
- LINE 配信本文(line_broadcasts 系)

### RLS(行レベルセキュリティ)

全テーブルで RLS が有効。`organization_id = current_user_organization_id()` で他組織のデータには物理的にアクセスできません。

### 運営アクセス

- 「保管」「本人同意済みの AI 処理」「法令対応」の範囲に限定
- プライバシーポリシーで明示
- 登録時に同意を取得

### バックアップとデータ移行

- Supabase 標準の自動バックアップ(日次)
- 解約時に CSV / JSON で全データをエクスポート可能(運営に依頼)

## 連携解除(求職者からの申請)

求職者が「連携解除を申請」すると:

1. revoke_requested 状態(猶予期間内)
2. エージェントが「即時承認」で確定 → revoked
3. または猶予期間(デフォルト N 日)経過で cron(`finalize-revokes`)が自動 revoked 確定
4. 解除後はエージェントから求職者の履歴書 / 職経歴書 / 希望条件は閲覧不可

## トラブル時の対応

### LINE が反応しない

1. `/agency/line/settings` で Channel Access Token が正しいか確認
2. Webhook URL が LINE Developers に登録されているか確認
3. Channel Secret が一致しているか(署名検証で失敗すると 401)

### Google 連携で「アクセスをブロック」が出る

- アプリが「テスト中」ステータスの場合、テストユーザー登録が必要
- 解決: Google Cloud Console → OAuth consent screen → テストユーザー → メールアドレスを追加

### AI 残数が増えない

- ai_usage_events への INSERT が CHECK 制約違反で失敗していないかログ確認
- 通常は 2026-06 修正後すべての kind が記録される

### Daily ダイジェストが来ない

1. 個人設定 → 通知設定 で email_enabled + daily_digest が ON か確認
2. メール受信フォルダで「【Maira 朝のダイジェスト】」を検索
3. 集計が全件 0 の日は「平和な朝」として配信されません(仕様)

## 運用 Tips

- **朝の習慣**: Daily ダイジェストメール → ダッシュボード → 今日のタスク開始
- **週次レビュー**: レポート画面で先週の KPI を確認
- **月次締め**: 成約・売上を月初に確認、CSV エクスポートで会計に連携
- **メンバー追加時**: 招待 → 役割設定 → 推薦文テンプレ説明 → 主要画面の操作レクチャー
