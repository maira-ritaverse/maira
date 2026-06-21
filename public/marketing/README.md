# LP 用 スクリーン ショット 配置 ガイド

このディレクトリ に 実画面 の スクリーン ショット を 配置 する と、
LP (components/features/marketing/landing-page.tsx) で SVG モック の 代わり に
画像 が 表示 されます。

## 必要 ファイル (5 件)

| ファイル名              | 撮影 元 画面                                   | 想定 比率 |
| ----------------------- | ---------------------------------------------- | --------- |
| `dashboard.png`         | `/agency` (= ダッシュボード)                   | 16:10     |
| `line-conversation.png` | `/agency/line/[lineUserId]` (= LINE 個別 会話) | 16:10     |
| `line-ma.png`           | `/agency/marketing` (= LINE MA β)              | 16:10     |
| `calendar.png`          | `/agency/calendar` (= 月 ビュー)               | 16:10     |
| `report.png`            | `/agency/reports` (= レポート)                 | 16:10     |

## 推奨 解像 度

- **1600 × 1000 px** (16:10、 LP の `aspect-16/10` に 一致)
- それ より 大きく ても OK (object-cover で 上 寄せ 表示)
- 1.5 MB 以下 推奨 (Next.js Image で 自動 最適 化)

## 撮影 の コツ

- ブラウザ 幅 を 1280 px 程度 に 調整 (= デザイン が ぶ レない)
- 個人 情報 / メール アドレス は **ぼかす か ダミー データ で 撮影**
- システム UI (タブ、 URL バー) は **含めない** (= 画面 内 だけ をキャプチャ)
- macOS: `Cmd+Shift+4` → スペース → ウィンドウ クリック
- Windows: Snipping Tool で ウィンドウ 単位 を キャプチャ

## 配置 後 の 確認

ファイル を 置いた ら ブラウザ で `https://www.maira.pro` を リロード し、
該当 セクション に 画像 が 表示 さ れる ことを 確認。

ファイル が なけれ ば 自動 で SVG モック に フォール バック する 設計 なので、
段階 的 に 1 枚 ずつ 配置 OK。
