# 0004. AI SDK の選定

- ステータス:採用
- 決定日:2026-05-15

## 文脈

Maira は AI 対話を主機能の 1 つとしている:キャリア棚卸し / 履歴書 AI 添削 / 面接シミュレーター / エージェント向け要約。

実装にあたって以下の選択肢:

1. **Anthropic SDK を直接呼ぶ**:`@anthropic-ai/sdk` のみ。最大の自由度。
2. **Vercel AI SDK**:`ai` パッケージ + `@ai-sdk/anthropic`。フロント側 `useChat` で UI まで一気通貫。
3. **LangChain**:エコシステムが大きいがオーバーキル。

技術スタック(CLAUDE.md):Next.js 15 App Router + Anthropic API + Vercel デプロイ。

## 決定

Vercel AI SDK を主に採用、Anthropic SDK は補助で持つ。

- **対話形式**(キャリア棚卸し / 面接シミュレーター):Vercel AI SDK の `useChat` + `streamText`
  - フロント:`@ai-sdk/react` の `useChat` で UI ストリーミング
  - サーバ:`streamText` で system + messages を渡してストリーム返却
  - 履歴の persist は SDK 外側で:onFinish で DB に保存
- **単発生成**(要約・添削):同じく `streamText` で text ストリーム
- Anthropic SDK は `getModel(MODELS.CONVERSATION)` で Provider 経由(直接 import しない)

採用モデル:

- 会話 / 生成:`claude-sonnet-4-6`(MODELS.CONVERSATION)

## 結果

得たもの:

- フロント実装が劇的に楽(ストリーミング表示が自動)
- Edge / Node 両方で動く
- Provider を `@ai-sdk/openai` 等に差し替えれば他社モデルも使える(現状は Anthropic 固定)

諦めたもの / 課題:

- Vercel AI SDK のメジャーバージョン更新で破壊的変更があった(v5 → v6 でメッセージ形式変更)
- LangChain 流の「複雑なツールチェーン」が必要なら別途検討
- 1 トークンずつのデータ採取(usage tracking)は SDK 経由で取りにくい場面あり

## 代替案

1. **Anthropic SDK 直接**:却下。フロントのストリーミング実装が重い。
2. **LangChain**:却下。MVP 規模では過剰。
3. **OpenAI ベース**:却下。CLAUDE.md で Anthropic 固定。

## 関連実装

- [app/api/career/chat/route.ts](../../app/api/career/chat/route.ts)
- [app/api/interview/chat/route.ts](../../app/api/interview/chat/route.ts)
- [app/api/resumes/[id]/feedback/route.ts](../../app/api/resumes/[id]/feedback/route.ts)
- [lib/ai/client.ts](../../lib/ai/client.ts)
- [lib/ai/prompts/](../../lib/ai/prompts/)
