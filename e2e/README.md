# E2E テスト(Playwright)

## セットアップ

```bash
# 初回のみ:Playwright とブラウザを取得
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

## 実行

```bash
pnpm e2e          # ヘッドレスで全 spec(smoke + 認証付き)
pnpm e2e:ui       # 対話モード(失敗時にローカルで再現するとき)
```

dev サーバは `playwright.config.ts` の `webServer` が自動で立ち上げます。
既に立ち上げている場合は再利用されます(reuseExistingServer)。

## プロジェクト構成

`playwright.config.ts` で 5 プロジェクトを定義:

| プロジェクト名         | 対象 spec              | 用途                                                               |
| ---------------------- | ---------------------- | ------------------------------------------------------------------ |
| `chromium`             | `smoke.spec.ts`        | 認証不要のページが 200 を返すか                                    |
| `auth-setup`           | `auth.setup.ts`        | エージェントとしてログイン → storageState 保存                     |
| `seeker-auth-setup`    | `seeker-auth.setup.ts` | 求職者としてログイン → storageState 保存                           |
| `authenticated`        | `agency-flow.spec.ts`  | エージェント認証付きで各画面の到達を確認                           |
| `authenticated-seeker` | `seeker-flow.spec.ts`  | 求職者認証付きで AI 推薦 / 進捗 / 応募 / 履歴書 ページの到達を確認 |

各 `authenticated*` は対応する setup を `dependencies` に持ち、自動的に先に走ります。

## 環境変数

認証付きテストには以下が必要(未設定ならスキップ):

```
# エージェント(advisor / admin ロール)
E2E_TEST_USER_EMAIL=test-agent@example.com
E2E_TEST_USER_PASSWORD=...

# 求職者(individual アカウント)
E2E_TEST_SEEKER_EMAIL=test-seeker@example.com
E2E_TEST_SEEKER_PASSWORD=...
```

専用テスト organization + advisor / admin + 個人ユーザを **maira-dev** に事前作成しておく前提です。
本番環境(maira-prod)に向けて実行しないでください。

`E2E_BASE_URL` が設定されていればそちらを優先(リモート環境にぶつけたいとき用)。
`E2E_SKIP_SERVER=1` で `webServer` 自動起動をスキップします。

## storageState

`auth-setup` プロジェクトが `e2e/.auth/agent.json`、`seeker-auth-setup` が `e2e/.auth/seeker.json` に Cookie を保存します。
このディレクトリは `.gitignore` で追跡対象外です(機密情報を含むため)。

## 新規 spec を追加するときは

- 認証不要 → `e2e/smoke.spec.ts` に追加(または別 spec を作って `chromium` プロジェクトの `testMatch` に登録)
- エージェント認証必要 → `authenticated` プロジェクトの `testMatch` にパターン追加(現状は `agency-flow.spec.ts`)
- 求職者認証必要 → `authenticated-seeker` プロジェクトの `testMatch` にパターン追加(現状は `seeker-flow.spec.ts`)
