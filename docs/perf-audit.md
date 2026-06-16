# パフォーマンス監査(2026-06-15)

主要クエリパスを点検した結果のメモ。深刻な N+1 は無いが、改善余地のある箇所を記録。

## 確認済み:N+1 は発生していない箇所

### `listClientRecordsWithUpdateBadge(orgId, userId)`

並列 4 クエリ + 直前に 1 クエリ(対応履歴):

1. クライアント本体
2. resumes / cvs / career_profile updated_at(本人開示可のクライアントのみ)
3. client_view_states
4. client_interactions max occurred_at(沈黙判定用)

→ クライアント件数に比例して増えるクエリは無し。

### `listInteractionsByClient`

1 クエリ + 1 RPC(`list_organization_member_display_names`)で記録者名を解決。
→ メンバー名は組織単位の 1 回取得で N+1 を回避。

### `listClientAuditLog`

同上(履歴行数に対して RPC は 1 回のみ)。

### `listCalendarEvents`

3 ソース(client_records / agency_tasks / client_interactions)を並列取得 + 不足クライアント名を 1 件の `in (...)` で補完。
→ N+1 なし。

## 改善余地

### 1. ダッシュボード `/agency` の `getClientRecordsTotalCount` と `listClientRecordsWithUpdateBadge` の重複

`listClientRecordsWithUpdateBadge` 内部で全件取得しているのに、別途 `getClientRecordsTotalCount` で count を取っている。

**修正案**:`listClientRecordsWithUpdateBadge` の返値長を直接使えば 1 クエリ削減。
ただし「サーバページネーション切替判断のため total を別途取りたい」場合は現状維持で OK。

**判断**:現状維持(将来サーバページネーション化したら自然に別クエリになる)。

### 2. クライアント詳細ページの並列取得

`/agency/clients/[id]/page.tsx` で 8 クエリを `Promise.all` で並列実行。
各クエリは独立しており N+1 は無いが、行数が増えても応答時間は固定。

`listOrganizationMembers` が `listInteractionsByClient` 内でも別途呼ばれている(暗黙の二重取得)。

**修正案**:呼び出し階層で 1 度だけ取って引き回す。

**判断**:メンバー数は通常少数(数〜数十)で、1 RPC のコストは無視できる。保留。

### 3. 一括メール送信 `/api/agency/clients/bulk-email`

各クライアントに対し sequentially Resend API を叩いている。

**修正案**:Promise.allSettled で並列化。ただし Resend 側のレート制限(秒 10〜)に注意。

**判断**:現状の使用想定(数〜数十件)では問題なし。100 件超対応するなら並列化 + chunk リトライ。

## モニタリング推奨

将来の規模感で再点検すべき項目:

- `listClientRecordsWithUpdateBadge` の総処理時間(クライアント 1000 件超で要計測)
- `listCalendarEvents` の範囲(月単位)で 100 イベント超の場合の応答時間
- `client_audit_log` を 1 万行超持つ組織の `listClientAuditLog`(現状 200 件 limit で対処)

## インデックス確認

主要なインデックスは既に設定済み:

- `client_records (organization_id, created_at desc)`
- `client_interactions (organization_id, occurred_at desc)` — 沈黙判定で多用
- `client_audit_log (client_record_id, created_at desc)`
- `client_audit_log (organization_id, created_at desc)`
- `agency_tasks (organization_id, assigned_member_id, status)`
- `intake_forms (organization_id, created_at desc)`
- `crm_tags GIN`(タグ検索用)
- `client_records.organization_id`(クエリ多用)

将来追加候補(まだ未追加):

- `client_interactions (client_record_id, occurred_at desc)` — 顧客別履歴の高速化
- `referrals (organization_id, job_posting_id)` — マッチング画面用
