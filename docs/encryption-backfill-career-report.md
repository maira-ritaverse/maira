# career_profile バックフィル / 検証レポート(Step 4)

- 実行モード: `both`
- 開始: 2026-06-07T05:25:40.265Z
- 終了: 2026-06-07T05:25:41.172Z
- 対象: `public.career_profiles`
- 接続先 host: `pfebbpgcufintmulhydg.supabase.co` (maira-dev のみ許可)
- PII の生値は一切含めない(件数 / フィールド名 / 差分種別のみ)

## バックフィル結果

- スキャン対象(encrypted_data_v2 IS NULL の行): 0 件
- 暗号化して書き込んだ行: 0 件

## 検証結果(全行対象)

- ステータス: **PASS(差分 0)**
- 対象行(career_profiles 全行): 1 件
- 一致: 1 件
- 不一致: 0 件

## 次のステップ

差分 0 が確認できたので、Step 5(読み出しを v2 優先に切替)に進める。
