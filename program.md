# Myaira autoresearch(自律バグ探索・改善ループ)

karpathy/autoresearch の「AI が自律的に実験し、指標で keep/discard する」パターンを、
本番 SaaS「Myaira」向けに移植した指示書。autoresearch では指標が `val_bpb`(学習の質)
だったが、Myaira では**検証パイプラインの全通過 + 敵対的レビュー**を「地上真実の指標」と
する。エージェントはこの `program.md` に従い、専用ブランチ上でバグ修正・改善を自律的に回す。

autoresearch の思想は踏襲するが、**「全権限オフ・絶対に止まらない」はそのまま適用しない**。
Myaira は実ユーザーデータ・課金・セキュリティを持つ本番サービスであり、
CLAUDE.md の運用ルールが常に優先される。

## Setup(実験の準備)

1. **run タグ**: 当日の日付(例 `aug20`)。ブランチ `autoresearch/<tag>` を master(main)から作る。
   既存なら別タグ。**main では絶対に作業しない。**
2. **スコープ把握**: CLAUDE.md と直近の変更を読む。対象は下記「対象範囲」に限定。
3. **ベースライン確認**: `results.tsv`(未追跡)を作り、まず現状の検証パイプラインが
   グリーンかを記録する(下記「検証ゲート」)。落ちていればそれ自体が最初の修正対象。

## 対象範囲(What you CAN do)

低リスクで「壊れないことを機械的に確認できる」改善に限定する:

- 実バグの修正(nullセーフ、境界条件、誤ったロジック、未処理エラー)
- デッドコード / 未使用 export / 未使用依存の削除(削除は grep 前後 + build 必須)
- 型安全の強化(`any` 除去、戻り値/引数の型明示、網羅 switch の抜け)
- テストの追加(既存挙動の回帰テスト、境界のテスト)
- 明白なリファクタ(意味を変えない整理、重複の共通化)
- UI 文言の規約違反修正(日本語の半角スペース、絵文字、開発者ジャーゴン)

## やってはいけないこと(What you CANNOT do — 承認制)

以下は**このループの中で勝手にやらない**。見つけたら `results.tsv` に「要承認」で記録し、
人間に報告する(実装はしない):

- **push / デプロイ / main へのマージ**(ブランチに commit するのみ)
- **本番DB(maira-prod)への適用・prod マイグレーション**
- **DBスキーマ変更**(新テーブル/カラム/RLS/enum)
- **暗号化・鍵・認証・課金(Stripe)・RLS・セキュリティ境界の改変**
- **AI 呼び出しの新規追加やコスト増**(月額コストが増える変更)
- **外部ライブラリの新規追加**
- **既存マイグレーションファイルの編集**
- 挙動を変える大規模リファクタ(段階分割 + 承認が必要)

判断に迷うもの・影響が読めないものは「やらない側」に倒す。

## 検証ゲート(指標 = keep/discard の判定)

1 反復ごとに、変更後に必ず次を実行し、**全て通過**したときのみ keep できる:

```bash
pnpm exec tsc --noEmit          # 型エラー 0
pnpm exec eslint <変更ファイル>  # lint 0(全体は重いので変更ファイル中心)
pnpm exec vitest run <関連テスト> # 関連テスト green(新規テストも)
pnpm build                       # ビルド成功
```

さらに **変更ファイルに敵対的レビューエージェント**をかけ、critical/high が無いことを確認する
(feedback_default_review_agent の方針)。1つでも落ちたら **keep しない**。

## The loop(実験ループ)

専用ブランチ上で回す。

1. git 状態(ブランチ/コミット)を確認する。
2. 改善アイデアを 1 つ選ぶ(対象範囲内)。実装する。
3. 検証ゲートを回す(tsc / eslint / vitest / build / 敵対的レビュー)。
4. **全通過 かつ 実際に改善している** → git commit(ブランチを進める)。`results.tsv` に `keep`。
5. どれか落ちた / 改善が疑わしい → `git checkout -- .`(または `git reset --hard HEAD`)で破棄。
   `results.tsv` に `discard`。
6. 次の反復へ。

**簡潔性基準**(autoresearch より): 同等なら簡潔な方が良い。醜い複雑化を伴う微改善は不採用。
削除して同等以上なら積極的に keep。

**停止条件(Myaira 版)**: autoresearch の「絶対に止まるな」は**適用しない**。
次のときは一旦止まって人間に報告する:

- 「要承認」項目にぶつかったとき
- 実バグを見つけたが修正が承認制領域に及ぶとき
- 一定回数(例 5〜8 反復)ごとの区切り
- 判断に迷う設計判断が出たとき

## Logging(results.tsv、未追跡=commitしない)

タブ区切り。ヘッダ + 5 列:

```
commit	checks	status	description
```

1. git commit 短縮ハッシュ(discard は `-------`)
2. checks: `pass` / `fail` / `-`(未実行)
3. status: `keep` / `discard` / `needs-approval` / `baseline`
4. description: 何を試したか(タブは使わない)

例:

```
commit	checks	status	description
bb6fe2e	pass	baseline	現状の検証パイプラインがグリーンであることを確認
a1b2c3d	pass	keep	xxx の null 未処理を修正 + 回帰テスト追加
-------	fail	discard	yyy をリファクタしたが型エラーが出たため破棄
-------	-	needs-approval	zzz に RLS の穴の疑い(スキーマ変更を伴うため要承認)
```
