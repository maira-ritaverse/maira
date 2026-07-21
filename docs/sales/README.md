# Myaira 営業提案資料(NotebookLM 用ソース)

このディレクトリには、NotebookLM 等の AI ノートツールに取り込んで「営業提案資料」を AI と一緒に生成するための、構造化された Markdown ドキュメントを置いています。

製品操作マニュアルは `../manual/` に分かれています。こちらは「導入価値 / ROI / 競合比較 / FAQ」 = 営業の現場で使うことを想定。

## ファイル構成

| #   | ファイル                      | 内容                                               | 主な対象                      |
| --- | ----------------------------- | -------------------------------------------------- | ----------------------------- |
| 1   | `01-executive-summary.md`     | 1ページで分かる Myaira(経営層向け)                 | 経営者 / 役員                 |
| 2   | `02-market-and-pain.md`       | 業界課題 + Myaira 選定理由                         | 経営者 / 管理職               |
| 3   | `03-features-detail.md`       | 全機能 × 効果(10カテゴリ)                          | 現場リーダー / 情シス         |
| 4   | `04-pricing-roi.md`           | プラン構成 + 規模別 ROI 試算                       | 経営者 / CFO                  |
| 5   | `05-implementation.md`        | 導入ステップ / 工数 / データ移行                   | 情シス / プロジェクトリーダー |
| 6   | `06-security-compliance.md`   | セキュリティ / コンプライアンス                    | 情シス / 法務                 |
| 7   | `07-use-cases.md`             | 業種別ユースケース(IT / 医療 / 製造 等)            | 営業 / 業界別商談             |
| 8   | `08-competitive.md`           | 競合比較(HubSpot / Salesforce / 国内 SaaS / Excel) | 営業 / 競合がある商談         |
| 9   | `09-faq-objections.md`        | FAQ + 反論への答え                                 | 営業全般                      |
| 10  | `10-vision-and-philosophy.md` | Revorise 代表からの「思い」原稿(逐語組込用)        | 全読者(資料の心臓部)          |

補助:

| ファイル                | 内容                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `PROMPT-agency-deck.md` | 上記 10 本を元に長文営業資料(Markdown + Mermaid)を生成する LLM 用プロンプト |

合計: 10 ドキュメント + 生成プロンプト 1 本。

## NotebookLM への取り込み手順

1. https://notebooklm.google.com/ にログイン
2. 「新しいノートブック」 を作成
3. 「ソースを追加」 → 「ファイルをアップロード」
4. このディレクトリの 9 ファイルすべてを選択してアップロード
5. ソースタイトルを分かりやすく(例:「Myaira 経営層向け概要」「Myaira 機能詳細」)
6. ノートブックのチャットで提案資料を生成可能

## NotebookLM での活用例

### ① 業界別カスタム提案資料の生成

> 「IT エンジニア専門エージェント向けの提案資料を3ページにまとめて」
>
> → 07-use-cases.md の IT 部分 + 03-features-detail.md の LINE / AI マッチング部分 + 04-pricing-roi.md の中堅プランの ROI を統合して出力

### ② 経営層向け1ページサマリー

> 「中堅エージェント企業(アドバイザー5名)向けの1ページ提案を、数字を中心にまとめて」
>
> → 01-executive-summary.md + 04-pricing-roi.md の試算例2 を抜粋して出力

### ③ 反論対応の即時生成

> 「『AI に頼ると質が下がる』 という反論への返答案を3パターン出して」
>
> → 09-faq-objections.md の F2 を元に、業種ごとのバリエーションを生成

### ④ 競合比較表の自動作成

> 「現状 HubSpot を使っている企業に対する切り替え提案を、比較表中心で作成」
>
> → 08-competitive.md の HubSpot 部分を中心にカスタマイズ

### ⑤ FAQ ドキュメントの自動生成

> 「セキュリティに関する質問が10件出る前提で、Q&A 形式の FAQ を作成」
>
> → 06-security-compliance.md + 09-faq-objections.md カテゴリ C を統合

## 活用シーン

### 営業活動

- 商談前: 業種に合った提案資料を NotebookLM で生成 → スライド化
- 商談中: 反論が出たら NotebookLM に投げて即座に答えを生成
- 商談後: フォローアップメールの下書きを生成

### 社内研修

- 新人営業: NotebookLM に「Myaira の営業トーク練習相手になって」 と頼んで対話練習
- 営業マニュアル: 9 ファイル + 業種ごとの想定ロールプレイ集を作成

### マーケティング

- ホワイトペーパー: 業種別 ROI 試算を中心に PDF 化
- ブログ記事: 「中堅エージェント企業が抱える6つの課題」 を 02 から抽出してブログ記事化
- セミナー資料: 経営層向けセミナーの 60 分構成を生成

## PDF / Google Docs への変換

NotebookLM では Markdown をそのまま読み込めますが、印刷用の PDF や Google Docs が必要な場合:

### Pandoc で PDF 化

```bash
# 全ファイルを 1 PDF に
pandoc docs/sales/*.md -o maira-sales.pdf --pdf-engine=xelatex \
  -V mainfont="Hiragino Sans" --toc

# 個別ファイルを PDF 化
pandoc docs/sales/01-executive-summary.md -o executive-summary.pdf --pdf-engine=xelatex \
  -V mainfont="Hiragino Sans"
```

### Google Docs に貼り付け

1. ターゲットファイル(例: `01-executive-summary.md`)を VS Code で開く
2. Markdown Preview Enhanced 等で HTML プレビュー → Google Docs に貼り付け
3. 表 / 見出し / リストは自動で反映

### Marp / Slidev でスライド化

経営層向けプレゼン資料が必要な場合は、Marp や Slidev で 01 を元にスライド化:

```bash
# Marp(VS Code 拡張)
# 01-executive-summary.md を Marp 形式に変換してスライド化
```

## 更新方針

- 機能追加 / 重要な仕様変更があったら該当 .md を更新
- 月次レビューで料金 / ROI 試算の数字を最新化
- 営業現場で出た新しい質問は 09-faq-objections.md に追加
- 新しい業種ニーズは 07-use-cases.md に追加
- 大きな変更があれば NotebookLM 側のソースも再アップロード
