# role-debug 棚卸し監査レポート

- 監査日: 2026-06-01
- 監査対象ブランチ: `main`(コミット 48db891 時点)
- 監査範囲: 開発中に追加された「ロール偽装 / 権限切り替え / RLS バイパス /
  その他デバッグ専用」面の洗い出し
- 重要: **本レポートは監査のみ**。コードの削除・編集、DB(maira-dev /
  maira-prod いずれも)への接続は一切行っていない。

---

## 探索手法

以下のキーワードを `grep -rn` で総当たり(大文字小文字・区切り違いを網羅、
`node_modules` / `.next` を除外)。

- `role-debug` / `roleDebug` / `role_debug` / `debugRole` / `debug_role`
- `impersonate` / `impersonation` / `switch-role` / `asRole` / `act-as` /
  `sudo` / `superuser`
- `x-debug` / `debug-mode` / `DEBUG_ROLE` / `bypass`
- `NEXT_PUBLIC_*` で `DEBUG` / `IMPERSONATE` / `BYPASS` / `ROLE` / `ADMIN` /
  `DEV` を含むもの
- `service_role` / `createServiceClient` / `createAdminClient`
- `auth.uid` / `setSession` / `signInAnonymously` / 任意セッション差し替えパターン
- カスタム認証ヘッダ: `x-debug-user` / `x-impersonate` / `x-as-user` /
  `x-test-user` / `cookie.*debug`
- NODE_ENV ガード: `if.*NODE_ENV.*development` / `isDev` / `__DEV__` / `IS_DEV`
- 日本語マーカー: `本番リリース前` / `本番リリース時` / `開発確認用` / `開発用`
- マイグレーション: `SECURITY DEFINER` / `GRANT` / `REVOKE` / `CREATE ROLE` /
  `ALTER ROLE` / `service_role`
- `app/` 配下のディレクトリ走査: `debug` / `admin` / `impersonate` / `dev*` /
  `_*` を含むパス
- 機密検出(値は出力せず存在確認のみ): `sk-ant-` / `sbp_` / `sk_live_` /
  `sk_test_` / `whsec_`

---

## 分類サマリ

| 分類                                                 | 件数               |
| ---------------------------------------------------- | ------------------ |
| **REMOVE**(明らかにデバッグ専用・正規コードから独立) | 4                  |
| **REVIEW**(正規コードと絡んでおり判断要)             | 2                  |
| **GUARD**(env / NODE_ENV 等のガードで守られている)   | 0                  |
| **UNRELATED**(キーワード一致だが実体は無関係)        | 多数(本文末尾参照) |

**最優先警告:** なし。

- 認証 / 認可 / `middleware.ts` に刺さっている debug 経路は **検出されなかった**。
- `NEXT_PUBLIC_*` 経由でロール / 権限を制御している箇所は **検出されなかった**。
- ハードコードされた機密(`sk-ant-` / `sbp_` / `sk_live_` / `sk_test_` /
  `whsec_`)はソースツリー内に **検出されなかった**(`.env` / `node_modules` 除外)。
- `service_role` キーを使う `createServiceClient` の呼び出し元は
  [lib/supabase/service.ts](lib/supabase/service.ts) 内のみで、`window !==
undefined` のガードで保護されている(`throw` する)。
- `supabase/migrations/` 内に debug 専用ロール / テスト用 admin 付与 /
  緩い debug 用 RLS ポリシーは **検出されなかった**。

---

## 詳細(REMOVE)

| #   | ファイル:行                                                                             | 何をしているか                                                                                                                                                                                                                                                                                                                                                 | 分類   |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | [app/(app)/app/role-debug/page.tsx:1-54](<app/(app)/app/role-debug/page.tsx>)           | 現ユーザー自身のロール情報(`getUserRole(user.id)`)を画面に表示するだけの開発用ページ。ロール偽装・権限変更・RLS バイパスは一切なし。ファイル冒頭コメントに「本番リリース前に削除 or 管理者限定にする予定」と明記。サイドバーから到達するリンクはなく、URL 直打ち(`/app/role-debug`)でのみ到達可能。認証チェックのみあり(未ログインは `/auth/login` に飛ばす)。 | REMOVE |
| 2   | [app/(app)/app/test-chat/page.tsx:1-25](<app/(app)/app/test-chat/page.tsx>)             | 開発確認用 AI チャットページ(コメントに「本番リリース前に削除」明記、会話履歴は完全揮発)。                                                                                                                                                                                                                                                                     | REMOVE |
| 3   | [app/(app)/app/test-chat/chat-form.tsx:1-114](<app/(app)/app/test-chat/chat-form.tsx>)  | 上記ページの Client Component。`useChat()` で `/api/chat` を叩く。                                                                                                                                                                                                                                                                                             | REMOVE |
| 4   | [app/(marketing)/test-supabase/page.tsx:1-79](<app/(marketing)/test-supabase/page.tsx>) | **公開ルート**(`/test-supabase`)。`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` の "設定有無" を ✅/❌ で表示。値そのものは表示しないが、本番環境で公開されたままだと「サービスの構成状態」を未認証者に晒すため早めに消すのが望ましい。コメントに「本番リリース前に削除すること」明記。                           | REMOVE |

---

## 詳細(REVIEW)

| #   | ファイル:行                                                     | 何をしているか                                                                                                                                                                                                 | 絡んでいる正規コード                                                                                                                                                                                                                                                                       | 分類   |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 5   | [app/api/chat/route.ts:1-58](app/api/chat/route.ts)             | 現状は `/app/test-chat` 専用の Chat API。`TEST_CHAT_SYSTEM_PROMPT` を `system` に渡して `streamText` で応答する。認証チェック(未ログインは 401)あり。`createServiceClient` は使っておらず RLS バイパスはなし。 | 本番モジュール(キャリア棚卸し / 書類作成 / 応募管理)で本格的なチャット API を別途立てる計画なら、このルートごと **削除**。同じ `/api/chat` パスを本番チャットの基盤として転用するなら、**REMOVE 対象 1〜4 と一緒に消さず**、本番用 system prompt(モジュール別)に差し替える方針判断が必要。 | REVIEW |
| 6   | [lib/ai/prompts/test-chat.ts:1-19](lib/ai/prompts/test-chat.ts) | `TEST_CHAT_SYSTEM_PROMPT` の定義本体。ファイル冒頭コメントに「本番モジュールでは各モジュール専用のプロンプトを別途用意する」と明記。                                                                           | [app/api/chat/route.ts:5](app/api/chat/route.ts#L5) からのみ import されている。#5 の判断と連動。                                                                                                                                                                                          | REVIEW |

---

## サイドバー / ナビ依存(REMOVE 時に併せて触る箇所)

| ファイル:行                                                                     | 内容                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [components/features/app-sidebar.tsx:7](components/features/app-sidebar.tsx#L7) | `navItems` 配列に `{ href: "/app/test-chat", label: "AI動作確認", icon: "🤖" }` がある。REMOVE #2 を削除する際は **同時にこの行も削る**(残すと存在しないルートへのリンクが本番サイドバーに残る)。 |

`role-debug` / `test-supabase` はサイドバーから参照されていないため、ナビ側の修正は不要。

---

## 削除順序の依存関係

依存関係を整理すると、以下の順で安全に外せる(後段ほど判断が要る):

1. **Phase A(独立・低リスク)**
   - [app/(app)/app/role-debug/page.tsx](<app/(app)/app/role-debug/page.tsx>)(REMOVE #1)
   - [app/(marketing)/test-supabase/page.tsx](<app/(marketing)/test-supabase/page.tsx>)(REMOVE #4)
   - どちらもサイドバー非依存。フォルダごと消して動作確認可。

2. **Phase B(連動削除)**
   - [components/features/app-sidebar.tsx:7](components/features/app-sidebar.tsx#L7) のリンク削除
   - → [app/(app)/app/test-chat/page.tsx](<app/(app)/app/test-chat/page.tsx>)(REMOVE #2)
   - → [app/(app)/app/test-chat/chat-form.tsx](<app/(app)/app/test-chat/chat-form.tsx>)(REMOVE #3)
   - リンクを先に消してからページ本体を消すと、ビルドエラーや 404 リンクが
     残る期間が無くなる。

3. **Phase C(判断要)**
   - [app/api/chat/route.ts](app/api/chat/route.ts)(REVIEW #5)
   - [lib/ai/prompts/test-chat.ts](lib/ai/prompts/test-chat.ts)(REVIEW #6)
   - **方針 A**: 本番チャットを別ルートで作る → 両方とも削除可。
   - **方針 B**: `/api/chat` を本番チャットの基盤として転用 → ルート本体は
     残し、`system` に渡すプロンプトを本番用に差し替え。`test-chat.ts` は削除。
   - β 版ローンチ前にユーザー判断が必要。

---

## 確認した正規コード(問題なし)

監査の過程で「ロール / RLS / 認証」周りを通読し、以下については
**debug 経路の混入はなかった** ことを確認した。

| ファイル                                                                                                                                       | 確認内容                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [middleware.ts](middleware.ts)                                                                                                                 | `updateSession(request)` を呼ぶだけ。debug 分岐なし。                                                                                                                                                                                                                               |
| [lib/supabase/middleware.ts:12-61](lib/supabase/middleware.ts)                                                                                 | 未ログイン者を `/auth/login` へ、既ログイン者を `/app` へリダイレクトするだけ。`NEXT_PUBLIC_SUPABASE_ANON_KEY` のみ使用(service_role は使っていない)。debug 分岐なし。                                                                                                              |
| [lib/supabase/server.ts](lib/supabase/server.ts) / [lib/supabase/client.ts](lib/supabase/client.ts)                                            | いずれも anon キーのみ使用。debug 分岐なし。                                                                                                                                                                                                                                        |
| [lib/supabase/service.ts:15-33](lib/supabase/service.ts)                                                                                       | `createServiceClient()` は `typeof window !== "undefined"` で throw。呼び出し元はリポジトリ内に存在せず(grep で 0 件)、`scripts/backfill-resume-pii.ts` のみが類似処理を直接 `@supabase/supabase-js` で実装(これは backfill スクリプトで正規)。                                     |
| [lib/organizations/queries.ts:17-91](lib/organizations/queries.ts)                                                                             | `getUserRole`。`organization_members` レコード未存在時は安全側で seeker 扱い(コメントに明記:「企業メンバーのフリで全テナント横断データが見える事故を防ぐため」)。debug 経路なし。                                                                                                   |
| [app/(agency)/agency/layout.tsx:18-51](<app/(agency)/agency/layout.tsx>)                                                                       | `account_type !== "organization_member"` または `!role.organization` または `!role.member` の場合は `/app` に戻すロールガード。debug 経路なし。                                                                                                                                     |
| [supabase/migrations/20260530000001_add_multitenant_foundation.sql](supabase/migrations/20260530000001_add_multitenant_foundation.sql)         | `organization_members.role` の CHECK 制約は `('admin', 'advisor')` の **2 値のみ**。debug 用ロールなし。                                                                                                                                                                            |
| [supabase/migrations/20260531000002_fix_organization_rls_recursion.sql](supabase/migrations/20260531000002_fix_organization_rls_recursion.sql) | `current_user_organization_id()` / `current_user_organization_role()` は `SECURITY DEFINER` だが、内部で `auth.uid()` から自分の 1 行しか取り出さない実装。引数で他人を指定できないため、impersonation には使えない。コメントにも「RLS 再帰回避用」「admin 権限の緩和なし」と明記。 |
| [supabase/migrations/20260531000005_add_member_display_names_fn.sql](supabase/migrations/20260531000005_add_member_display_names_fn.sql)       | `list_organization_member_display_names(target_organization_id)` は `SECURITY DEFINER` だが、`target_organization_id = current_user_organization_id()` のチェックで呼び出し元が同組織メンバーであることを内部検証している(他組織のメンバー情報は 0 件を返す)。                      |
| [supabase/functions/](supabase/functions/)                                                                                                     | `.gitkeep` のみ。Edge Function は未実装。                                                                                                                                                                                                                                           |
| [supabase/migrations/](supabase/migrations/) 全体                                                                                              | `CREATE ROLE` / `ALTER ROLE` / `GRANT` は一切なし。RLS ポリシーは全テーブルで `auth.uid()` ベース。debug 用の緩いポリシーは検出されず。                                                                                                                                             |
| `NODE_ENV` / `isDev` / `__DEV__` 系の dev-only ブランチ                                                                                        | アプリケーションコード内では検出されず。`lib/pdf/generate.ts` の `process.env.NODE_ENV === "production"` は Chromium 実行パス切替のための正規分岐。                                                                                                                                 |

---

## UNRELATED(参考: キーワード一致したが debug ではないもの)

- `supabase/migrations/` 内の "admin"(多数): 正規の `organization_members.role`
  の値("admin" / "advisor")。テナント内権限の正規モデル。
- `supabase/migrations/20260518000003_setup_rls.sql` 内の "service_role" 言及:
  `subscriptions` / `notifications` 等の INSERT/UPDATE を service_role 限定
  にする旨のコメント(CLAUDE.md の方針通り)。
- `types/env.d.ts:14` の `SUPABASE_SERVICE_ROLE_KEY` 型宣言: 環境変数の型定義のみ。
- `scripts/backfill-resume-pii.ts:13,396`: backfill スクリプトの service_role
  キー使用(運用上の正規用途、ユーザーが手元で実行する想定)。
- `lib/crypto/field-encryption.ts:9` の「開発用の鍵生成手順」: ドキュメント
  コメントのみ。実行コードは production も dev も同一。

---

## 機密検出結果(値は記載しない)

ソースツリー内(`node_modules` / `.next` 除外)から `sk-ant-` / `sbp_` /
`sk_live_` / `sk_test_` / `whsec_` のいずれもヒットしなかった。
`.env` 系ファイルは `.gitignore` で追跡対象外。

---

## 完了条件チェック

- [x] `docs/role-debug-audit.md` を新規作成した。
- [x] コードは一切削除 / 編集していない(本ファイル新規作成と、進行管理用の
      TodoWrite 以外の Edit / Write は行っていない)。
- [x] DB(maira-dev / maira-prod いずれも)には接続していない
      (`supabase` CLI / SQL 実行ツールは一切起動していない)。
- [x] 機密値は本レポートに記載していない(存在確認結果のみ)。

---

## 次ステップ(削除フェーズに進む前に必要な判断)

1. **REVIEW #5 / #6 の方針確定**: `/api/chat` を本番チャットの基盤として
   転用するか、別ルートを新設するか。
2. **`role-debug` ページの扱い**: 完全削除か、`isOrganizationMember` の admin
   限定で残すか(コメントには「管理者限定にする予定」とある)。本番運用で
   運営者がユーザーのロール状態を確認する必要があるかどうかで判断。
3. 削除実施時は本レポートを順に潰し、Phase A → B → C の順で **小さい PR を
   3 本に分ける** ことを推奨(回帰時の切り戻しが容易)。
