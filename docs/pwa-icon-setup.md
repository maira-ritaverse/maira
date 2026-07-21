# PWA アイコン作成手順

ローンチ前にあなた側で 3 つのアイコンを `public/` に置いてください。

| ファイル名                     | サイズ  | purpose  | 用途                                          |
| ------------------------------ | ------- | -------- | --------------------------------------------- |
| `public/icon-192.png`          | 192×192 | any      | Android ホーム + 通常 favicon                 |
| `public/icon-512.png`          | 512×512 | any      | PWA インストール時の大アイコン                |
| `public/icon-maskable-512.png` | 512×512 | maskable | Android のアダプティブアイコン(円形/角丸対応) |

## 推奨デザイン

- 背景は `#10b981`(マニフェストの `theme_color` と一致)もしくは白
- 中央に「M」または「Myaira」のロゴマーク
- maskable 版は **セーフゾーン(中央 80%)** にロゴが収まるように。外側 10% は塗りつぶしか単色背景にする(Android が円形にクロップする)

## 簡単な作り方(SVG → PNG)

1. SVG でロゴを描く(Figma / Inkscape)
2. 192x192 / 512x512 にエクスポート
3. maskable 版は背景を全面塗りつぶして外側 10% 余白を確保
4. 上記ファイル名で `public/` に配置

## 作成後の確認

```bash
# Lighthouse の PWA 監査で確認
# Chrome DevTools → Lighthouse → "Progressive Web App" を ON で計測
```

未配置の状態でもアプリは動作しますが、ブラウザの開発ツール console に 404 が出ます。
