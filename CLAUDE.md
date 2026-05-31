# Maira - Project Guidelines for Claude Code

このファイルはClaude Codeへの指示書です。すべての作業で必ず守ってください。

## プロジェクト概要

Maira(マイラ)は、20-30代の転職活動者向けのAI採用エージェントです。
4つのモジュール(キャリア棚卸し、書類作成、応募管理、音声面接)を提供する
Webアプリ(PWA)です。

**最重要の差別化要素**:

1. プロアクティブな伴走(期限催促、進捗管理)
2. 音声面接シミュレーター(β版では未実装、本格ローンチで追加)
3. クライアントサイド暗号化(運営者もユーザーデータを復号できない)

## 技術スタック(固定・変更禁止)

- フロントエンド: Next.js 15 (App Router) + TypeScript
- スタイル: Tailwind CSS + shadcn/ui
- バックエンド/DB: Supabase (PostgreSQL + Auth + Edge Functions)
- AI: Anthropic API (Claude Sonnet 4.6)
- 決済: Stripe Subscription
- ホスティング: Vercel
- メール: Resend
- DNS: Cloudflare
- アイコン: lucide-react
- フォーム: react-hook-form + zod
- 暗号化: Web Crypto API(外部ライブラリ禁止)

**勝手に技術選定を変えないこと**。代替案を提案するのは構いませんが、
ユーザーの承認なしに別のライブラリを導入しないでください。

## コーディング規約

### 言語・ファイル構成

- ファイル名: kebab-case(例: career-profile.tsx)
- コンポーネント名: PascalCase
- 関数・変数: camelCase
- 型: PascalCase、interfaceではなくtypeを優先

### ディレクトリ構造

app/ # Next.js App Router
(marketing)/ # LP、料金、規約等の公開ページ
(auth)/ # 認証関連
(app)/ # 認証後のアプリ本体
api/ # APIルート
components/ # 共有コンポーネント
ui/ # shadcn/uiのコンポーネント
features/ # 機能別コンポーネント
lib/ # ユーティリティ・ヘルパー
crypto/ # 暗号化関連(最重要)
supabase/ # Supabaseクライアント
ai/ # Anthropic API関連
types/ # 型定義
supabase/ # マイグレーション・Edge Functions

### コメント方針

- コメントは日本語で書く
- 「なぜそうしたか」を書く(「何をしているか」はコードで分かる)
- 暗号化・セキュリティ関連は特に詳しくコメントする

## セキュリティ・暗号化の絶対ルール

### 暗号化対象(必ず暗号化する)

- 会話履歴(messages.encrypted_content)
- キャリア棚卸し結果(career_profiles.encrypted_data)
- 応募情報(applications.encrypted_details)
- タスク内容(tasks.encrypted_title, encrypted_description)
- 通知ペイロード(notifications.encrypted_payload)
- 会話タイトル(conversations.encrypted_title)

### 暗号化方式

- 対称暗号: AES-256-GCM(Web Crypto API)
- 鍵導出: PBKDF2(Web Crypto APIで利用可能なもの)
- IV: レコードごとに新規生成、encryption_ivカラムに保存

### 絶対にやってはいけないこと

- 平文をDB(Supabase)に保存しない
- マスターキーをlocalStorageに保存しない(sessionStorageは可)
- console.logで暗号化前のデータを出力しない
- 暗号化を「後で実装します」とコメントしてスキップしない

### AI推論時の扱い

- ブラウザのメモリ上で一時復号→Anthropic APIへ送信
- サーバーには平文を保存しない
- ストリーミング応答も暗号化してから保存する

## Supabase RLS(行レベルセキュリティ)の絶対ルール

- 全テーブルでRLSを有効化する
- 全テーブルで「auth.uid() = user_id」のポリシーを必ず作る
- subscriptionsテーブルのINSERT/UPDATEはservice_roleのみ
  (Stripe Webhook経由でのみ書き込む)
- RLSを無効化したり、ポリシーを削除したりするマイグレーションは作らない

## データベース(Supabase)運用ルール

- マイグレーションの `supabase db push` は、開発環境 maira-dev
  (pfebbpgcufintmulhydg)に対してのみ実行する。
- 本番環境 maira-prod(xxatkimjfiaidxfuglae)への適用は、
  リリース前にまとめて、かつユーザーからの明示的な指示があった時のみ。
- `supabase db push` の前に、必ず `supabase projects list` で
  現在リンクしているプロジェクトが maira-dev であることを確認する。
- 「リモートSupabase = 本番」ではない。dev も prod も別々のリモート
  プロジェクトである。URLやプロジェクトIDで必ず区別すること。
- 報告時、「本番に適用」「リモートに適用」等の表現を使う場合は、
  実際にどのプロジェクト(dev/prod)に適用したかを正確に確認してから書く。

## 作業の進め方

### ユーザーが指示を出したら

1. まず指示を完全に理解したか確認する。曖昧な点は質問する
2. 既存コードを必ず読んでから着手する
3. 変更計画を箇条書きで提示する
4. ユーザーの承認を得てから実装する

### 実装するとき

- 一度に大量のファイルを変更しない(最大5ファイル)
- 既存の動作を破壊する変更は事前に必ず警告する
- TypeScriptの型を必ず明示する。anyは禁止
- エラーハンドリングを必ず書く

### 完了したら

- 変更したファイル一覧を報告する
- テスト方法をユーザーに伝える
- 既知の問題があれば正直に報告する

## やってはいけないこと(重要)

- 指示されていない機能を追加しない
- 指示されていないライブラリをinstallしない
- 既存のマイグレーションファイルを編集しない(新規ファイルを追加する)
- .envファイルや本番のシークレットをコードに含めない
- "// TODO: 後で実装"を残さない(実装するか、明確にissueに切り出す)
- 動作未確認のコードを「動きます」と報告しない

## プロジェクト固有のルール(運用知見)

### ファイルパス・命名

- プロジェクトルートは /Users/arakaki/Maira(macOSのcase-insensitive)
- importパスは必ず小文字で書く(例:@/lib/utils であり @/Lib/Utils ではない)
- ファイル名は kebab-case を厳守

### lib/utils の扱い

- lib/utils.ts:shadcn/uiの cn 関数のみ。これはここから動かさない
- それ以外のユーティリティは機能別ディレクトリに分ける
  - 日付関連: lib/date/
  - 暗号化: lib/crypto/
  - フォーマット: lib/formatting/
    など
- lib/utils/ という名前のディレクトリは作らない(lib/utils.tsと混同するため)

### Git運用

- このプロジェクトのコミットは maira-ritaverse 名義
- リモートは git@github.com-maira:maira-ritaverse/maira.git(SSH エイリアス)
- 機密情報(.env、APIキー等)を含むファイルは絶対にcommitしない
- .claude/settings.local.json は追跡対象外(個人設定のため)

### shadcn/ui のバージョン

- shadcn v4 系を使用
- @base-ui/react が基盤(@radix-ui/react-\* ではない)
- 新しいコンポーネントを追加するときは:
  pnpm dlx shadcn@latest add [component-name]

### 既知の制約

- pnpm-workspace.yaml の allowBuilds で sharp, msw を承認済み
  (これらを未承認に戻すと install が失敗する)
- next lint は Next.js 16 では非推奨。eslint コマンドを直接使う

## ユーザーについて

ユーザーは19歳の経営者で、Web開発の経験はあるがフルスタックは初心者です。

- 専門用語は使ってOK、ただし初出時は簡潔に説明する
- 「なぜこの実装を選んだか」を毎回明示する
- ユーザーが手動でやる必要がある作業(環境変数の設定、Vercelでのデプロイなど)は
  明示的にステップバイステップで指示する

## 質問・確認のルール

以下の場合は必ず作業を止めて確認する:

- セキュリティに影響する変更
- DBスキーマの変更
- 既存機能を壊す可能性がある変更
- 月額コストが発生する変更(外部APIの利用等)
- ユーザーデータの取り扱いに関わる変更
