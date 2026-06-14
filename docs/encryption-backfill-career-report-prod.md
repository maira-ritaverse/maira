# career_profile バックフィル / 検証レポート(prod)

- 実行モード: `verify`
- UPDATE 反映: NO(SELECT のみ)
- 開始: 2026-06-10T06:27:36.229Z
- 終了: 2026-06-10T06:27:37.240Z
- 対象: `public.career_profiles`
- 接続先 host: `xxatkimjfiaidxfuglae.supabase.co` (maira-prod を要求)
- PII の生値・鍵値は一切含めない(件数 / rowId / フィールド名 / 種別のみ)

## 検証結果(全行対象)

- ステータス: **PASS(差分 0)**
- 対象行(career_profiles 全行): 1 件
- 一致: 1 件
- 不一致: 0 件

## 次のステップ

差分 0 が確認できたので、prod アプリ側の読み出し切替フェーズに進める。
