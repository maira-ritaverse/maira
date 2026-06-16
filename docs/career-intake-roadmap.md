# キャリア面談アップロード(career-intake)実装ロードマップ

## 現状(Phase 1)

- POST `/api/career-intake/recordings` で「アップロード → Whisper → Claude → 暗号化保存」を **1 リクエストで同期実行**。
- Vercel Pro の 60 秒制限と Whisper 25 MiB 制限の両方をハード上限としている。
- 状態は `uploaded → transcribing → transcribed → extracting → extracted`(失敗時は `failed_*`)。
- UI は同期完了後に `router.refresh()` で結果を読み直す + 5 秒ポーリングで「処理中」状態を救済。

### 既知の制約

| 観点           | 上限 / 振る舞い            | 影響                                       |
| -------------- | -------------------------- | ------------------------------------------ |
| ファイルサイズ | 25 MiB(Whisper API)        | おおむね 60 分未満の音声まで               |
| 時間           | 60 秒(Vercel)              | 長尺ファイルの後半が timeout する可能性    |
| 並列度         | 1 リクエスト = 1 sync 処理 | 同時複数アップロードでサーバが詰まりやすい |

## Phase 2 検討:長尺音声対応

### 案 A:Chunk アップロード + 順次転写

クライアントサイドでファイルを 24 MiB 以下のセグメントに分割し、各セグメントを順に
`/api/career-intake/recordings/[id]/append-chunk` に POST。サーバは:

1. 各チャンクを別 Storage パスに保管
2. Whisper で個別転写
3. 全チャンク完了後にテキスト結合 → Claude 抽出

メリット:Vercel 60 秒制限を回避可能
デメリット:UI 実装が重い(分割ロジック・進捗バー)、無音点で切らないと文字化けする箇所が出る

### 案 B:Background Job(推奨)

POST `/recordings` は **アップロードのみ** で即時 return(`status='uploaded'`)。
別の Worker(Supabase Edge Function / Inngest / Trigger.dev など)が:

1. `uploaded` 行を pickup
2. Storage から音声を取得
3. Whisper → Claude → 暗号化保存
4. 完了通知(in_app notification + 任意で email)

メリット:時間制限なし、並列度を Worker 側で制御可能、UI 側は polling のみで完結
デメリット:Worker インフラを別途用意する必要あり

### 案 C:Whisper 以外の transcription サービス

- Deepgram、Rev.ai、AssemblyAI などには **非同期 API + webhook** が標準装備されている
- リクエスト数制限が緩い
- メリット:Worker を自前で持たなくて済む
- デメリット:別サービスとの契約 / コスト

## 推奨ルート

1. **MVP(現状):同期処理 + 25 MiB / 60 秒制限を UI で明示**
2. **次:案 B(Background Job)** ← 基盤実装済(2026-06-16)
   - DB に `processing_started_at` / `processing_lease_until` / `retry_count` を追加(マイグレーション 20260616000003)
   - 楽観ロックベースの pickup endpoint:[/api/internal/career-intake/pickup](../app/api/internal/career-intake/pickup/route.ts)
   - 認証は `INTAKE_CRON_SECRET` 環境変数 + `X-Cron-Secret` ヘッダー
   - 外部 cron(Vercel Cron / Inngest / pg_cron + http など)から定期呼び出しする想定
   - 同期処理(POST /recordings)はそのまま、timeout 等で uploaded のまま残った行を救う用途
3. **規模拡大時:案 C(Deepgram など)** に乗り換えてレートと品質を向上

### Vercel Cron 設定例(vercel.json)

```json
{
  "crons": [{ "path": "/api/internal/career-intake/pickup", "schedule": "*/1 * * * *" }]
}
```

加えて Vercel 環境変数に `INTAKE_CRON_SECRET` を設定し、cron ジョブ側で
`X-Cron-Secret` ヘッダに同値を渡す必要があります(Vercel Cron の場合は
`Authorization: Bearer $CRON_SECRET` の組み合わせも検討)。

## 並走で着手したい改善

- [ ] アップロード前にブラウザで `OfflineAudioContext` を使って簡易音量チェック
      (無音アップロード防止、推定時間表示)
- [ ] ファイル形式バリデーション(MP4 / MOV の動画から音声トラックだけ取り出す軽量変換)
- [ ] 抽出失敗時のリトライ UI(`/recordings/[id]/retry` で再処理)
- [ ] 取得した文字起こしを後から閲覧 / コピーできる詳細ページ

## 法的観点(継続)

- 利用規約 第 4 条で「他参加者全員の事前同意取得」を利用者の義務として明記済(2026-06-15)
- プライバシーポリシー 第 5 条で AI 処理基盤(Whisper / Claude)を明示済
- 録音メタ(参加者リスト・録音同意の証憑)を保管する仕組みは未実装。
  Phase 2 で「同意取得チェック」UI を録音アップロード時にも追加する案あり
