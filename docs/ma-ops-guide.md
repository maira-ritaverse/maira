# MA(マーケティングオートメーション)運用ガイド

このドキュメントは Maira の MA 機能(Phase C-1 〜 C-3)を **dev / prod にデプロイ・運用する手順** をまとめたものです。

---

## 1. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│ ブラウザ (admin)                                                 │
│   /agency/marketing                                              │
│     ├ シナリオ ON/OFF                                            │
│     ├ テンプレ編集                                                │
│     ├ テスト送信                                                  │
│     └ 送信履歴                                                    │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Next.js API (Vercel)                                             │
│   /api/agency/ma/scenarios     [GET/PATCH]                       │
│   /api/agency/ma/templates/:id [GET/PUT]    暗号化保存            │
│   /api/agency/ma/consent       [POST/DELETE]                     │
│   /api/agency/ma/scenarios/:id/test-send [POST]                  │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase (DB + Edge Function)                                    │
│   テーブル:                                                       │
│     ma_scenario_presets   (7 種類、共通マスタ)                    │
│     ma_scenarios          (組織別 ON/OFF + 日数上書き)            │
│     ma_templates          (件名/本文、AES-256-GCM 暗号化)         │
│     ma_consent_log        (配信特約の同意 + 撤回ログ)             │
│     ma_send_logs          (1 通ごとの送信結果、暗号化)            │
│                                                                  │
│   Edge Function: ma-send-campaign                                │
│     pg_cron で 1 日 1 回起動 →                                   │
│       1. 有効化シナリオ取得                                       │
│       2. 同意撤回チェック                                         │
│       3. シナリオ判定(対象 client_records 抽出)                  │
│       4. テンプレ復号 + 変数展開                                  │
│       5. Resend で送信                                            │
│       6. ma_send_logs に暗号化記録                                │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Resend (外部 SaaS)                                                │
│   noreply@maira.pro から実送信                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 必要な環境変数

### Vercel(Web 側 API ルート用)

| 変数名                             | 例                         | 用途                                              |
| ---------------------------------- | -------------------------- | ------------------------------------------------- |
| `RESEND_API_KEY`                   | `re_xxxxxxxx`              | テスト送信時の Resend 認証                        |
| `EMAIL_FROM`                       | `noreply@maira.pro`        | 送信元アドレス。Resend で verify 済みドメインのみ |
| `FIELD_ENCRYPTION_KEYS`            | `{"v1":"<base64-32byte>"}` | テンプレ・送信ログの暗号化鍵(dev/prod で別)       |
| `FIELD_ENCRYPTION_CURRENT_VERSION` | `v1`                       | 現在の鍵バージョン                                |
| `NEXT_PUBLIC_SUPABASE_URL`         | (既存)                     |                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`    | (既存)                     |                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`        | (既存)                     |                                                   |

### Supabase Secrets(Edge Function 用、`supabase secrets set` で設定)

| 変数名                             | 値                 | 用途                                         |
| ---------------------------------- | ------------------ | -------------------------------------------- |
| `RESEND_API_KEY`                   | Vercel と同じ値    | 自動配信の Resend 認証                       |
| `EMAIL_FROM`                       | Vercel と同じ値    | 送信元アドレス                               |
| `FIELD_ENCRYPTION_KEYS`            | Vercel と同じ JSON | Web 側と同じ鍵を使う(両者は同じ暗号文を扱う) |
| `FIELD_ENCRYPTION_CURRENT_VERSION` | Vercel と同じ      |                                              |

> `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Supabase が自動で注入するため設定不要。

### 鍵生成方法(初回のみ)

```bash
# 32 バイトのランダム値を base64 で出力
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

出力例: `Yk7G...32 文字...=`。これを次の JSON にして環境変数にセット:

```json
{ "v1": "Yk7G...32 文字...=" }
```

**dev と prod で必ず別の鍵を使うこと**(片方の鍵漏洩で両方が読まれるのを防ぐ)。

---

## 3. デプロイ手順

### 3.1 dev へのデプロイ

```bash
# 1. リンクが maira-dev か確認(! このコマンドが先!)
supabase projects list
# ● が maira-dev (pfebbpgcufintmulhydg) に付いていることを確認

# 2. マイグレーション適用
supabase db push

# 3. Edge Function デプロイ
supabase functions deploy ma-send-campaign

# 4. Secrets 設定(初回のみ、または更新時)
supabase secrets set \
  RESEND_API_KEY=re_xxx \
  EMAIL_FROM=noreply@maira.pro \
  FIELD_ENCRYPTION_KEYS='{"v1":"<base64-32byte>"}' \
  FIELD_ENCRYPTION_CURRENT_VERSION=v1

# 5. 動作確認(手動 invoke)
curl -X POST "https://pfebbpgcufintmulhydg.supabase.co/functions/v1/ma-send-campaign" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY_DEV}"
# レスポンス例: {"ok":true,"stats":{"scenarios_processed":1,"sent":0,"skipped":1,...}}
```

### 3.2 prod へのデプロイ

CLAUDE.md ルール: **prod 適用はユーザーからの明示指示があった時のみ**。以下の手順は参考。

```bash
# 1. prod に切り替え
supabase link --project-ref xxatkimjfiaidxfuglae
supabase projects list  # ● が maira-prod に移っていることを確認

# 2. 以下、dev と同じ手順で db push / functions deploy / secrets set
# ただし FIELD_ENCRYPTION_KEYS は dev とは違う鍵を使う

# 3. pg_cron 登録(初回のみ、prod の SQL Editor で)
select cron.schedule(
  'ma-send-campaign-daily',
  '0 23 * * *',  -- UTC 23:00 = JST 08:00
  $$
  select net.http_post(
    url := 'https://xxatkimjfiaidxfuglae.supabase.co/functions/v1/ma-send-campaign',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  );
  $$
);

# cron 確認
select * from cron.job where jobname = 'ma-send-campaign-daily';
```

> `app.settings.service_role_key` は Supabase Dashboard → Database → Settings で事前に設定する必要があります。
> ハードコードは絶対しないこと(履歴に残ってしまう)。

### 3.3 cron の停止/削除

```sql
select cron.unschedule('ma-send-campaign-daily');
```

---

## 4. 動作確認チェックリスト

### 4.1 Web UI(dev / prod 共通)

- [ ] `/agency/marketing` を開ける(サイドバーに 📣 マーケティング)
- [ ] 「有効化する」→ 同意モーダル → 同意で「✓ 有効化済み」表示
- [ ] シナリオを「配信開始」(現状実装済みは 2 つ:登録者への面談促進 / 休眠求職者掘り起こし)
- [ ] 「テンプレート編集」で件名・本文を保存できる
- [ ] 「テスト送信」で自分のメアドに 1 通届く(Resend 設定済みの場合)
- [ ] 「送信履歴」画面で結果が表示される(フィルタ動作 + 行展開で本文表示)

### 4.2 Edge Function

- [ ] `curl` で手動 invoke すると stats が返る
- [ ] `ma_send_logs` に新規行が追加される(`select status, count(*) from public.ma_send_logs group by status;`)
- [ ] **dev で「準備中」シナリオを有効化しても判定スキップ**される(過剰送信防止の確認)
- [ ] **同意撤回後は送信されない**(撤回 → 手動 invoke → stats.sent が増えない)
- [ ] **テンプレ未保存シナリオは status='skipped' で記録**される

### 4.3 暗号化

- [ ] dev / prod でそれぞれ独立の鍵が設定されている(同じ鍵を使い回さない)
- [ ] Web で保存したテンプレを Edge Function 側で復号できる(逆も同様)
- [ ] DB 直接閲覧時、`encrypted_subject` / `encrypted_body` が `v1:xxxxxx` 形式の暗号文になっている

---

## 5. トラブルシューティング

### Q1: Edge Function を invoke しても何も送信されない

**原因の可能性**:

1. **有効化されたシナリオが無い**

   ```sql
   select s.id, p.key, s.is_active from public.ma_scenarios s
     join public.ma_scenario_presets p on s.preset_id = p.id
     where s.is_active = true;
   ```

   → 行が無ければ UI で有効化する

2. **テンプレが未保存**

   ```sql
   select scenario_id, encrypted_subject is null as no_subject
     from public.ma_templates;
   ```

   → `no_subject = true` のシナリオはテンプレ編集で件名・本文を入れる

3. **同意が撤回されている**

   ```sql
   select feature, accepted_at, revoked_at from public.ma_consent_log
     where organization_id = '<your-org-id>'
     order by accepted_at desc;
   ```

   → 全行の `revoked_at` が非 null なら、UI で「有効化する」を再実行

4. **シナリオキーが「準備中」セット**
   - `lib/ma/types.ts` の `IMPLEMENTED_SCENARIO_KEYS` に含まれないシナリオは Edge Function でスキップされる
   - 現状実装済: `register_meeting_promotion` / `dormant_outreach`

### Q2: テスト送信で「Resend が未設定」と出る

→ Vercel 環境変数 `RESEND_API_KEY` と `EMAIL_FROM` を確認。両方ともセットされていないと `status='skipped'` で記録される。

### Q3: 暗号化エラー(Cannot find key version)

→ `FIELD_ENCRYPTION_KEYS` と `FIELD_ENCRYPTION_CURRENT_VERSION` が dev/prod それぞれで設定されているか確認。鍵をローテーションした場合、古い暗号文を読むために旧バージョンの鍵も JSON 内に残しておく必要がある:

```json
{ "v1": "<old-key>", "v2": "<new-key>" }
```

`FIELD_ENCRYPTION_CURRENT_VERSION=v2` にすると、新規暗号化は v2 で行われ、旧データ(v1)は引き続き復号できる。

### Q4: 「送信履歴」画面が空のままなのに、実際は送信されている

→ RLS の組織所属確認。`organization_members` テーブルに自分の `user_id` の行があるか、`organization_id` が一致しているか確認。

---

## 6. シナリオ拡張のロードマップ

### 現状実装済み(2 種類)

| key                          | 起点                                          | 条件                         |
| ---------------------------- | --------------------------------------------- | ---------------------------- |
| `register_meeting_promotion` | `client_records.created_at` + N 日            | `client_interactions` ゼロ件 |
| `dormant_outreach`           | 最新 `client_interactions.occurred_at` + N 日 | クローズ済みステータス除外   |

### 未実装(必要なテーブル追加が前提)

| key                        | 必要なテーブル/カラム                                       |
| -------------------------- | ----------------------------------------------------------- |
| `meeting_reminder`         | `interviews` テーブル                                       |
| `job_introduction`         | `interviews` + `referrals.status='introduced'` の判定       |
| `after_interview_followup` | `interviews.status='completed'` + `follow_up_sent` フラグ   |
| `post_placement_followup`  | `referrals.status='placed'` + `onboard_email_sent` フラグ   |
| `birthday_greeting`        | `career_profiles.date_of_birth`(暗号化フィールドの復号判定) |

新シナリオを追加する手順:

1. `supabase/functions/ma-send-campaign/scenarios.ts` に `findXxxCandidates()` を追加
2. `index.ts` の dispatcher 分岐に 1 行追加
3. `lib/ma/types.ts` の `IMPLEMENTED_SCENARIO_KEYS` に key 追加
4. Edge Function 再デプロイ

---

## 7. 関連ファイル一覧

```
supabase/
  migrations/
    20260615000001_add_ma_tables.sql              テーブル+プリセット投入
    20260615000002_add_ma_send_logs.sql           送信ログテーブル
    20260615000003_add_ma_send_logs_admin_insert.sql  テスト送信用 RLS 緩和
  functions/ma-send-campaign/
    index.ts                  メインハンドラ
    scenarios.ts              判定ロジック
    template-expander.ts      変数展開
    field-encryption.ts       AES-256-GCM(Web 側と同期)
    resend.ts                 HTTP API ラッパー

lib/ma/
  types.ts                    型 + IMPLEMENTED_SCENARIO_KEYS
  queries.ts                  DB アクセス(復号付き)
  test-send.ts                テスト送信ロジック

app/api/agency/ma/
  scenarios/route.ts          ON/OFF 切替
  consent/route.ts            同意 + 撤回
  templates/[scenarioId]/route.ts          テンプレ取得 + 保存
  scenarios/[scenarioId]/test-send/route.ts  テスト送信

app/(agency)/agency/marketing/
  page.tsx                    シナリオ一覧サーバーCS
  scenario-list.tsx           クライアントUI
  consent-modal.tsx           同意モーダル
  test-send-modal.tsx         テスト送信モーダル
  [scenarioId]/template/      テンプレ編集ページ
  logs/                       送信履歴画面
```
