# ADR(Architecture Decision Records)

設計判断とその背景を「決まった事実 + 理由 + 当時の代替案」として残す場所。

## 命名規則

```
NNNN-short-title.md
```

例:`0001-encryption-strategy.md`

連番は単調増加。途中で却下したものも残し、ファイルは消さない。

## テンプレート

```markdown
# NNNN. タイトル

- ステータス:採用 / 検討中 / 却下 / 撤回
- 決定日:YYYY-MM-DD

## 文脈

なぜこの判断が必要になったのか。状況、制約、要求。

## 決定

何を採用したか。具体的に。

## 結果

採用したことで得られたもの / 諦めたもの / 将来の課題。

## 代替案

検討した他の選択肢と、却下した理由。
```

## 既存 ADR

- [0001](./0001-encryption-strategy.md) 暗号化戦略
- [0002](./0002-rls-based-authorization.md) RLS ベース認可
- [0003](./0003-client-side-filter-sort.md) クライアント側フィルタ / ソート
- [0004](./0004-ai-sdk-choice.md) AI SDK の選定
- [0005](./0005-api-helpers-pattern.md) API ヘルパパターン
- [0006](./0006-server-side-encryption-direction.md) サーバーサイド暗号化への方針確定
