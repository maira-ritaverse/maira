# 暗号化マニフェスト(履歴書 / 求職者 PII)

最終更新: 2026-06-01
ステータス: **提案(リッタさん承認待ち)** — このマニフェスト自体はまだ DB を変えていない

このドキュメントは、Myaira の履歴書および求職者 PII を保持するテーブル・
カラムを棚卸しし、Step 3(アクセス層への組み込み + バックフィル)に向けて
「どのカラムを暗号化するか / どのカラムを平文で残すか」の案をまとめたもの。

最終判断はリッタさん。Claude は案と根拠を出すだけ。

## 提案アクション 4 分類

| 分類           | 意味                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **[ENCRYPT]**  | `lib/crypto/field-encryption.ts` で AES-256-GCM 暗号化を推奨。text 型でクエリ依存なし。                                                      |
| **[KEEP]**     | 平文維持。RLS 条件 / FK / unique / 検索キー / システム値などクエリ可能である必要があるもの。                                                 |
| **[EMAIL]**    | 平文維持 + 照合用の決定的ハッシュ列(HMAC-SHA256)を別途追加して招待・突合に使う案。                                                           |
| **[DECISION]** | 非 text 型(date / numeric / jsonb / CHECK 制約付き text)で、暗号化には型変更や構造変更が必要。複数案をトレードオフ付きで提示し、決定しない。 |

> ⚠️ ランダム IV を使う AES-GCM の性質上、**同じ平文を入れても毎回違う暗号文**になる。
> そのため `eq()` / `unique` / `index lookup` / `RLS WHERE` で使うカラムは
> 暗号化すると壊れる。[KEEP] か [EMAIL] にしないと等価検索ができなくなる。

## 対象テーブル全体図

このステップで対象とした PII 保持テーブル:

| テーブル                | スコープ        | 現状                    | 主な担当           |
| ----------------------- | --------------- | ----------------------- | ------------------ |
| `public.resumes`        | 本人所有 (BtoC) | 全平文 ❗               | 履歴書本体         |
| `public.client_records` | 企業所有 (BtoB) | 全平文 ❗               | CRM 上の求職者情報 |
| `public.referrals`      | 企業所有 (BtoB) | 全平文 ❗ (notesのみ)   | 推薦メモ           |
| `public.profiles`       | 共通            | 部分(key関連のみ暗号化) | display_name 等    |

参考(対象外 / すでに暗号化設計済み):

- `conversations.encrypted_title`, `messages.encrypted_content`,
  `career_profiles.encrypted_data`, `applications.encrypted_details`,
  `tasks.encrypted_*`, `notifications.encrypted_payload` は
  すでに `bytea` 列で暗号化前提に設計済み(`encryption_iv` あり)。
  → 本マニフェストではスコープ外。Step 1 の field-encryption は AES-GCM の
  「IV を ciphertext に内包」する別フォーマットなので、`bytea` 系の置き換えは別ステップで検討する。

---

## 1. `public.resumes`(本人所有・履歴書)

定義: [supabase/migrations/20260531000006_add_resumes.sql](../supabase/migrations/20260531000006_add_resumes.sql) +
[20260531000007_add_resume_fields.sql](../supabase/migrations/20260531000007_add_resume_fields.sql) +
[20260531000008_add_resume_document_date.sql](../supabase/migrations/20260531000008_add_resume_document_date.sql)

RLS: `user_id = auth.uid()`(4 ポリシー、本人のみ全操作可能)
インデックス: `idx_resumes_user_id` on `(user_id)`

| カラム                 | 型          | NULL | 制約 / index / FK / RLS で使う         | 検索/並び替えで使う(コード)                     | 提案                                                                                                           |
| ---------------------- | ----------- | ---- | -------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                   | uuid        | NOT  | PK                                     | `.eq("id", …)` で参照                           | **[KEEP]** — システム ID                                                                                       |
| `user_id`              | uuid        | NOT  | FK→auth.users, index, **RLS 条件**     | `.eq("user_id", …)`                             | **[KEEP]** — RLS 必須                                                                                          |
| `title`                | text        | NOT  | default `'履歴書'`                     | 一覧表示                                        | **[KEEP]** — ユーザー識別ラベル。PII ではないので平文で扱う方が UX 上ラク。<br>※ 厳格にやるなら ENCRYPT も可。 |
| `name`                 | text        | YES  | なし                                   | 表示のみ。`where` 等なし                        | **[ENCRYPT]** — 氏名(最重要 PII)                                                                               |
| `name_kana`            | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — ふりがな                                                                                       |
| `birth_date`           | **date**    | YES  | なし                                   | 表示のみ                                        | **[DECISION]** — 後述                                                                                          |
| `gender`               | text        | YES  | **CHECK** in (male/female/unspecified) | 表示のみ                                        | **[DECISION]** — 後述                                                                                          |
| `postal_code`          | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 郵便番号                                                                                       |
| `address`              | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 住所(最重要 PII)                                                                               |
| `address_kana`         | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 住所ふりがな                                                                                   |
| `phone`                | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 電話番号                                                                                       |
| `email`                | text        | YES  | なし                                   | 表示のみ。コード上で `where email = …` 検索なし | **[ENCRYPT]** — 本人入力のメール。突合に使われていないので EMAIL カテゴリ不要                                  |
| `contact_address`      | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 連絡先住所                                                                                     |
| `contact_address_kana` | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 連絡先ふりがな                                                                                 |
| `contact_phone`        | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 連絡先電話                                                                                     |
| `photo_url`            | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 顔写真 URL(直接 PII ではないが URL 自体が個人特定に繋がる)                                     |
| `education_history`    | **jsonb**   | NOT  | default `'[]'::jsonb`                  | 表示のみ                                        | **[DECISION]** — 後述                                                                                          |
| `licenses`             | **jsonb**   | NOT  | default `'[]'::jsonb`                  | 表示のみ                                        | **[DECISION]** — 後述                                                                                          |
| `motivation_note`      | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 志望動機(自由記述)                                                                             |
| `personal_requests`    | text        | YES  | なし                                   | 表示のみ                                        | **[ENCRYPT]** — 本人希望(自由記述)                                                                             |
| `document_date`        | **date**    | YES  | なし                                   | 表示のみ                                        | **[DECISION]**(または **[KEEP]**)— 後述                                                                        |
| `created_at`           | timestamptz | NOT  | default `now()`                        | 並び替え                                        | **[KEEP]** — メタデータ                                                                                        |
| `updated_at`           | timestamptz | NOT  | default `now()`                        | `.order("updated_at", …)`(一覧表示)             | **[KEEP]** — メタデータ                                                                                        |

### resumes の [DECISION] 項目

すべて「非 text 型のため、AES-GCM の戻り値(string)をそのまま入れられない」が共通の理由。
それぞれ案 A / 案 B を併記する。

#### `birth_date` (date)

- **案 A: 型を `text` に変更し [ENCRYPT]**
  - メリット: 暗号化方針が他のカラムと揃う。日付フォーマットの自由度が増す(西暦/和暦)。
  - デメリット: 既存データのバックフィルが必要(空ならゼロコスト)。`date` 型の制約バリデーションが効かなくなる(zod 側で担保)。
- **案 B: 平文維持 [KEEP]**
  - メリット: スキーマ変更不要。生年月日カラムだけ平文なら影響は限定的。
  - デメリット: 生年月日は単独でも識別力が高い PII。住所と組めば特定可能性が上がる。「全暗号化」というユーザーメッセージと矛盾する。
- **案 C(推奨候補): 暗号化 JSON にまとめる**
  - 「氏名・住所・生年月日・連絡先など PII をまとめて 1 つの `encrypted_personal_info` text に JSON 暗号化」する設計に振る。
  - メリット: カラムを増やさない / IV 1 つで済む / フォーマット変更に強い。
  - デメリット: 部分更新ができない(履歴書フォームは全項目上書きなので実は問題なし)。スキーマ移行のコストが大きい。
  - **検討事項**: もし JSON 内包方式にするなら、resumes テーブル全体の設計を「平文メタ列 + 1 つの暗号化ペイロード列」に再構成する必要があり、本ステップの個別カラム表とは別アプローチになる。リッタさん判断。

#### `gender` (text, CHECK 制約付き)

- **案 A: CHECK を外して [ENCRYPT]**
  - メリット: 他の自由記述項目と揃う。
  - デメリット: 値の整合性は zod でしか保てなくなる。enum 性が薄れる。
- **案 B: 平文維持 [KEEP]**
  - メリット: スキーマ変更不要。CHECK で値が守れる。
  - デメリット: 単独では弱い PII だが、他フィールドと組めば識別力に寄与する。
- 推奨: 案 B(影響小)または案 C と同じく暗号化 JSON 内に含める。

#### `education_history`, `licenses` (jsonb, NOT NULL DEFAULT '[]')

- **案 A: 型を `text` に変更して [ENCRYPT]**
  - メリット: 内容は典型的に学校名・職歴・資格名で PII 性が高い → 暗号化したい。
  - デメリット: jsonb の演算子(`->>`, `@>`)が使えなくなる。
    現状コード上では使っていない(`SELECT *` で受けて TS 側でパース)ので影響は小さい。
    NOT NULL DEFAULT '[]'::jsonb の扱いをどうするか要検討(text のデフォルトを `'[]'` にする等)。
- **案 B: 平文維持 [KEEP]**
  - メリット: スキーマ変更不要。
  - デメリット: 履歴書のうち**最も PII 性が高い項目**(学歴/職歴/資格)が平文残留。
- **推奨: 案 A** — 学歴/職歴は暗号化対象として最重要のひとつ。

#### `document_date` (date)

- 提出日であり、PII というよりは履歴書の運用メタデータ。
- **推奨: [KEEP]** — 平文維持で運用上の問題なし。

---

## 2. `public.client_records`(企業所有・BtoB CRM)

定義: [supabase/migrations/20260531000001_add_client_records.sql](../supabase/migrations/20260531000001_add_client_records.sql)

RLS: `organization_id`(自社のみ) + `linked_user_id = auth.uid()`(紐づいた求職者本人)
インデックス: `idx_client_records_email`, `idx_client_records_org_id`, `idx_client_records_assigned`, `idx_client_records_linked_user`

| カラム                     | 型          | NULL | 制約 / index / FK / RLS                                                | 検索/絞り込み                                      | 提案                                         |
| -------------------------- | ----------- | ---- | ---------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `id`                       | uuid        | NOT  | PK                                                                     | `.eq("id", …)`                                     | **[KEEP]**                                   |
| `organization_id`          | uuid        | NOT  | FK, index, **RLS 条件**                                                | `.eq("organization_id", …)`                        | **[KEEP]** — RLS 必須                        |
| `assigned_member_id`       | uuid        | YES  | FK, index                                                              | `.eq("assigned_member_id", …)`(担当者別表示)       | **[KEEP]** — FK 必須                         |
| `name`                     | text        | NOT  | なし(将来検索に使う可能性 ⚠)                                           | 一覧表示。現状コード上で `where name = …` 検索なし | **[ENCRYPT]**(後述ブロッカー参照)            |
| **`email`**                | text        | NOT  | **index** `idx_client_records_email`                                   | 招待時の突合キー候補                               | **[EMAIL]** — 後述                           |
| `phone`                    | text        | YES  | なし                                                                   | 表示のみ                                           | **[ENCRYPT]**                                |
| `status`                   | text        | NOT  | CHECK in (initial_meeting/...), 並び替え対象                           | フィルタ・並び替え                                 | **[KEEP]** — 業務ステータス                  |
| `link_status`              | text        | NOT  | CHECK in (unlinked/invited/linked/revoked), **RLS 条件**(`= 'linked'`) | フィルタ                                           | **[KEEP]** — RLS 必須                        |
| `linked_user_id`           | uuid        | YES  | FK→auth.users, index, **RLS 条件**                                     | `.eq("linked_user_id", …)`                         | **[KEEP]** — RLS 必須                        |
| `linked_at`, `revoked_at`  | timestamptz | YES  | なし                                                                   | 表示・監査                                         | **[KEEP]**                                   |
| `notes`                    | text        | YES  | なし                                                                   | 表示のみ。`where notes = …` 検索なし               | **[ENCRYPT]** — アドバイザーが書く求職者メモ |
| `created_at`, `updated_at` | timestamptz | NOT  | default `now()`                                                        | 並び替え                                           | **[KEEP]**                                   |

### client_records.email についての判断(EMAIL カテゴリ)

- 現状: `idx_client_records_email` を持ち、エージェントが「クライアント招待」フロー
  (`link_status = invited` → 求職者がメールから承諾 → `linked` 化)で
  メール一致による突合を想定している。
  ※ 突合コードは現時点では未実装に近い(grep 上「`linked_user_id` 紐付け」の
  本実装まで踏み込んでいない)が、index が貼られているので将来も使う前提。
- **推奨方針 [EMAIL]**:
  1. `email` カラムは「正規化済み平文(`lower(trim(email))`)」を維持(検索キーとしての利用権を残す)。
  2. 列追加案として、新たに `email_hmac` text 列を Step 3 で導入し、決定的 HMAC-SHA256
     (鍵は環境変数で別管理)を保存する。突合は HMAC で行う。
  3. 表示用には「マスク表示」(`***@example.com`)に倒し、平文の生 email は
     アドバイザー操作時のみアプリ層で復号 / 表示する設計に倒すか、
     **email だけは「BtoB 業務上必要なので平文許容」のままにする**かを選択。
- 重要: HMAC は決定的(同じメールは同じハッシュ)なので、**そもそも暗号化ではない**
  ことを認識する必要がある。突合用に必要だから割り切る選択。
- 最終判断はリッタさん。本マニフェストでは [EMAIL] = "平文維持 + 突合 HMAC 追加案を提示" としている。

### client_records.name についてのブロッカー(重要)

- 現状コード上は `name` を `where`/`order` に使っていない(SELECT で受けて TS 側で配列処理)。
- ただし CRM 一覧画面で「クライアント名で検索したい」「名前で並び替えたい」のは UX 上ありうる要求。
- ランダム IV で暗号化すると等価検索・前方一致・並び替えが全て不可になる。
- **判断**: 検索が必要になったときに [EMAIL] と同様に決定的ハッシュ列を追加する設計余地を残して
  **今は [ENCRYPT]** とする。リッタさんが「名前検索/並び替えを CRM の主要機能にする」と決めたら
  この判断を [DECISION] に格上げする必要がある。

---

## 3. `public.referrals`(企業所有・推薦)

定義: [supabase/migrations/20260531000004_add_referrals.sql](../supabase/migrations/20260531000004_add_referrals.sql)

| カラム                    | 型          | NULL | 用途                                   | 提案                                        |
| ------------------------- | ----------- | ---- | -------------------------------------- | ------------------------------------------- |
| `id`                      | uuid        | NOT  | PK                                     | **[KEEP]**                                  |
| `organization_id`         | uuid        | NOT  | FK, RLS                                | **[KEEP]**                                  |
| `client_record_id`        | uuid        | NOT  | FK, **unique(+job_posting_id)**, index | **[KEEP]**                                  |
| `job_posting_id`          | uuid        | NOT  | FK, unique 同上, index                 | **[KEEP]**                                  |
| `status`                  | text        | NOT  | CHECK 7 値, index                      | **[KEEP]**                                  |
| `notes`                   | text        | YES  | アドバイザーが書く推薦メモ             | **[ENCRYPT]** — クライアント PII を含みうる |
| `created_at`/`updated_at` | timestamptz | NOT  | メタデータ                             | **[KEEP]**                                  |

---

## 4. `public.profiles`(共通)

定義: [supabase/migrations/20260518000002_create_tables.sql](../supabase/migrations/20260518000002_create_tables.sql)

- [20260530000001_add_multitenant_foundation.sql](../supabase/migrations/20260530000001_add_multitenant_foundation.sql)
- [20260527000001_add_onboarded_at_to_profiles.sql](../supabase/migrations/20260527000001_add_onboarded_at_to_profiles.sql)

| カラム                                                       | 型          | NULL  | 用途                                                          | 提案                                          |
| ------------------------------------------------------------ | ----------- | ----- | ------------------------------------------------------------- | --------------------------------------------- |
| `id`                                                         | uuid        | NOT   | PK, FK→auth.users, RLS 条件                                   | **[KEEP]**                                    |
| `display_name`                                               | text        | YES   | 組織メンバー名表示・SECURITY DEFINER 関数で組織メンバー名取得 | **[DECISION]** — 後述                         |
| `encrypted_master_key`                                       | bytea       | NOT   | パスワード由来のマスターキー暗号化                            | **[KEEP]** — 既に暗号化されている前提         |
| `encrypted_master_key_by_recovery`                           | bytea       | NOT   | 同上(リカバリーキー由来)                                      | **[KEEP]**                                    |
| `password_salt`                                              | bytea       | NOT   | PBKDF2 salt                                                   | **[KEEP]** — 本来は擬似ランダムなので秘匿不要 |
| `recovery_key_hint`                                          | text        | YES   | リカバリーキーのヒント                                        | **[KEEP]** — ユーザーが入れた断片(原文非依存) |
| `account_type`                                               | text        | NOT   | CHECK, RLS の前提に使う可能性                                 | **[KEEP]**                                    |
| `onboarding_completed`, `preferred_industry`, `onboarded_at` | mixed       | mixed | UI/フラグ                                                     | **[KEEP]** — PII 性が低い                     |
| `created_at`/`updated_at`                                    | timestamptz | NOT   | メタデータ                                                    | **[KEEP]**                                    |

### profiles.display_name についての判断

- BtoB 側の `list_organization_member_display_names`(SECURITY DEFINER)で
  「組織メンバーの表示名」として他のメンバーから読まれる。つまり「同じ組織内」では
  共有される情報。
- **判断**: [KEEP] — display_name は「他人に見せる前提」なので暗号化対象外で OK。
  ただし、本名を入れている場合は実質 PII。今回のスコープ(履歴書 PII)からは外す。

---

## 5. ブロッカー / 注意点まとめ

このセクションは Step 3 を始める前に必ず読み返す。

### B-1. ランダム暗号化で壊れるもの(index / unique / FK / RLS / 検索キー)

| カラム                                                                  | 利用箇所                               | 影響                                          |
| ----------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| `resumes.user_id`                                                       | RLS, index                             | 既に [KEEP] 提案。問題なし。                  |
| `client_records.email`                                                  | `idx_client_records_email`, 招待突合用 | **要注意**。[EMAIL] 方針(HMAC 列追加)で対処。 |
| `client_records.organization_id`, `linked_user_id`, `link_status`       | RLS, FK                                | すべて [KEEP] 提案。問題なし。                |
| `client_records.name`                                                   | 現状は SELECT のみ。将来検索可能性 ⚠   | 検索要件が固まったら [DECISION] に格上げ。    |
| `referrals.{client_record_id, job_posting_id, organization_id, status}` | RLS, FK, unique                        | すべて [KEEP] 提案。問題なし。                |

### B-2. varchar(n) による桁あふれリスク

- 対象テーブルでは varchar(n) 形式の桁制限はなし(すべて `text` 型)。
- AES-GCM 暗号文 + base64url + `"v1:"` プレフィックスにより、
  暗号文は元の平文より長くなる(おおむね元の長さ + 28 byte 程度を base64url 化)。
- `text` 型なので問題なし。**ただし** Step 3 で別カラムを追加する場合
  (`email_hmac` 等)は `text` を使い、varchar(n) を使わない方針にする。

### B-3. BtoB CRM 検索要件のクロスチェック ⚠

- BtoC(`resumes`)では「本人のみ閲覧」+「フォームから全項目送って全体上書き」のため
  ENCRYPT で壊れるユースケースは見当たらない。
- BtoB(`client_records`)では「同じ組織内のメンバーが業務として閲覧・更新」する。
  - **現在のコードでは name / phone / notes を `where` / `order` に使っていない**
    (確認: lib/clients/queries.ts, app/api/agency/clients/route.ts ほか)
  - ただし CRM 一覧画面で将来「名前で検索」「メールで突合」「担当別フィルタ」を
    増やす要求が出る可能性が高い。
  - email については本マニフェストで [EMAIL] 方針を立てた。
  - name については今は [ENCRYPT] としつつ、必要になれば HMAC 列追加で対処する余地を残す。

### B-4. AI(Anthropic API)送信フラグ

- 現状、AI ルート(`app/api/chat`, `app/api/career/chat`, `app/api/career/generate-profile`,
  `app/api/documents/generate`, `app/api/applications/[id]/advisor`)は
  **`resumes` / `client_records` テーブルを参照していない**(grep 確認済み)。
- したがって「履歴書平文を Anthropic API に渡している」箇所は今のところゼロ。
- Step 3 / 将来、履歴書を AI レビューに渡す機能を追加する場合は
  「DB から暗号文を読む → アプリ層で復号 → Anthropic API 送信 → 応答は再暗号化して保存」
  という流れを意識する(CLAUDE.md「AI 推論時の扱い」と一致)。

### B-5. 既存データ移行(Step 3 のフォールバック前提)

- `field-encryption.ts` の `decryptField` はプレフィックス(`v1:` 等)が無い値を
  「移行前の平文」と見なしてそのまま返す。
- Step 3 のバックフィルでは
  「読み取り → 平文判定 → 暗号化 → 書き戻し」を冪等に走らせる設計が必要。
- バックフィル後に「すべての行が `v1:` プレフィックス付き」になったら、
  フォールバックを外す(将来のセキュリティ強化ステップ)。

---

## 6. 提案アクション集計

| 分類           | 件数 | 主な対象                                                                                                                                                                                                                                               |
| -------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[ENCRYPT]**  | 13   | `resumes.{name, name_kana, postal_code, address, address_kana, phone, email, contact_address, contact_address_kana, contact_phone, photo_url, motivation_note, personal_requests}`, `client_records.{name(条件付き), phone, notes}`, `referrals.notes` |
| **[KEEP]**     | 多数 | `*.id`, `user_id`, `organization_id`, RLS/FK/index 系すべて, status/タイムスタンプ系                                                                                                                                                                   |
| **[EMAIL]**    | 1    | `client_records.email`(平文維持 + `email_hmac` 列追加案)                                                                                                                                                                                               |
| **[DECISION]** | 4    | `resumes.birth_date`, `resumes.gender`, `resumes.education_history`, `resumes.licenses`(+ オプションで `document_date`)                                                                                                                                |

---

## 7. Step 3 に向けたデータアクセス箇所インベントリ

### resumes 読み書きパス

| ファイル                                                                        | 操作         | 備考                                                                |
| ------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| [lib/resumes/queries.ts](../lib/resumes/queries.ts)                             | CRUD 全部    | **暗号化フックの中心**。ここに encryptField/decryptField を組み込む |
| [app/api/resumes/route.ts](../app/api/resumes/route.ts)                         | POST 作成    | `createResume` 経由 → queries 経由で吸収可                          |
| [app/api/resumes/[id]/route.ts](../app/api/resumes/[id]/route.ts)               | PATCH/DELETE | `updateResume`, `deleteResume`, `verifyResumeOwner`                 |
| [app/api/resumes/[id]/pdf/route.ts](../app/api/resumes/[id]/pdf/route.ts)       | GET 読み出し | `getResume` 経由。PDF 生成のため平文必要 → 復号後にレンダリング     |
| [app/(app)/app/resumes/page.tsx](<../app/(app)/app/resumes/page.tsx>)           | 一覧 SSR     | `listResumes`                                                       |
| [app/(app)/app/resumes/[id]/page.tsx](<../app/(app)/app/resumes/[id]/page.tsx>) | 詳細 SSR     | `getResume`                                                         |

→ **すべて `lib/resumes/queries.ts` を経由している**。ここの 1 箇所を
暗号化境界にすれば全パスがカバーできる(理想形)。

### client_records 読み書きパス

| ファイル                                                                        | 操作           | 備考                                       |
| ------------------------------------------------------------------------------- | -------------- | ------------------------------------------ |
| [lib/clients/queries.ts](../lib/clients/queries.ts)                             | list/get       | 読み出しの中心                             |
| [app/api/agency/clients/route.ts](../app/api/agency/clients/route.ts)           | POST 作成      | name/email/phone/status/notes を受ける     |
| [app/api/agency/clients/[id]/route.ts](../app/api/agency/clients/[id]/route.ts) | PATCH 更新     | 部分更新あり(`d.email !== undefined` 判定) |
| [app/api/agency/referrals/route.ts](../app/api/agency/referrals/route.ts)       | referrals 作成 | notes が PII になり得る                    |

### referrals 読み書きパス

| ファイル                                                                  | 操作     | 備考                          |
| ------------------------------------------------------------------------- | -------- | ----------------------------- |
| [lib/referrals/queries.ts](../lib/referrals/queries.ts)                   | list/get | notes を持つ                  |
| [app/api/agency/referrals/route.ts](../app/api/agency/referrals/route.ts) | CRUD     | notes バリデーション zod 入り |

### Anthropic API 呼び出しと PII

| ファイル                                                                                    | PII 取り扱い    |
| ------------------------------------------------------------------------------------------- | --------------- |
| [app/api/chat/route.ts](../app/api/chat/route.ts)                                           | 履歴書非参照 ✅ |
| [app/api/career/chat/route.ts](../app/api/career/chat/route.ts)                             | 履歴書非参照 ✅ |
| [app/api/career/generate-profile/route.ts](../app/api/career/generate-profile/route.ts)     | 履歴書非参照 ✅ |
| [app/api/documents/generate/route.ts](../app/api/documents/generate/route.ts)               | 履歴書非参照 ✅ |
| [app/api/applications/[id]/advisor/route.ts](../app/api/applications/[id]/advisor/route.ts) | 履歴書非参照 ✅ |

**結論**: 現時点で「履歴書 PII が Anthropic API に渡る経路」は存在しない。
Step 3 では履歴書側だけ気にすればよい。将来 AI レビュー機能を追加する際に
復号→送信→再暗号化の境界を改めて引く必要がある。

---

## 8. DB 状態についての確認(重要)

- このマニフェスト作成中、**DB(maira-dev / maira-prod のどちらにも)書き込みを行っていない**。
- 読み取りも実 DB には接続せず、`supabase/migrations/` 配下の SQL ファイルのみを
  source of truth として参照した。
- マイグレーションファイルの新規作成・編集も行っていない。
- 暗号化コードの組み込み・呼び出し変更も行っていない。

次の Step 3 で初めて DB バックフィルが入る。承認後に進む。
