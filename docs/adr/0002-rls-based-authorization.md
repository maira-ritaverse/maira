# 0002. RLS ベース認可

- ステータス:採用
- 決定日:2026-05-25

## 文脈

マルチテナント SaaS(複数のエージェント企業 × 多数の求職者)で「自分のデータしか触れない」ことを保証する必要がある。

ナイーブなアプローチ:アプリケーションコードで毎回 `WHERE user_id = ?` を書く。
問題:

- 書き忘れによるデータ漏洩(一箇所の漏れで全件流出)
- 新しい API ルートを追加するたびに認可ロジックを再実装
- レビューで全行を追跡できないリスク

## 決定

Supabase の Row Level Security(RLS)を全テーブルで有効化し、ポリシーを **データベース層で** 強制する。

- すべてのテーブルで `alter table ... enable row level security`
- 自分のデータ:`auth.uid() = user_id` ポリシー
- 組織スコープ:`organization_id = current_user_organization_id()` ポリシー
  - `current_user_organization_id()` は RLS 再帰を回避するために `SECURITY DEFINER` SQL 関数で実装
- admin / advisor の区別:`current_user_organization_role() = 'admin'` で INSERT/UPDATE/DELETE を絞る
- API ルート側でも `eq("organization_id", ...)` で二重防御
- service_role は本当に必要な場面(public フォーム / Stripe Webhook / 通知ファンアウト)のみ

## 結果

得たもの:

- アプリ層の認可漏れが致命的にならない(DB 層が最後の砦)
- 新規 API ルートで認可を「書き忘れる」事故を防ぐ
- ポリシーは SQL でレビューしやすい

諦めたもの / 課題:

- RLS ポリシーで複雑な join 認可は表現しづらい(別途 SECURITY DEFINER RPC で対応)
- service_role を使う場面では RLS が効かない(別途アプリ層で organization_id 検証が必要)
- 初心者は「なぜこのクエリが空配列で返るのか?」が分かりづらい(`auth.uid()` が null とか)

## 代替案

1. **アプリ層だけで認可**:却下。書き忘れリスクが高い。
2. **PostgreSQL のスキーマ分離(テナント別 DB)**:却下。スケーリングコストとマイグレーション運用が重い。
3. **RLS + アプリ層の二重防御**(採用):RLS を主、アプリ層を補助に。
