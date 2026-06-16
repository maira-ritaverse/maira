#!/usr/bin/env bash
# =====================================================================
# Supabase 型生成スクリプト(dev 環境専用)
#
# 出力先:lib/supabase/database.types.ts
# 接続先:DB_PROJECT_REF 環境変数で指定(デフォルト = maira-dev)
#
# 使い方:
#   # 1) maira-dev で再生成(デフォルト)
#   ./scripts/gen-supabase-types.sh
#
#   # 2) 他環境を指定(本番は基本使わない)
#   DB_PROJECT_REF=xxx ./scripts/gen-supabase-types.sh
#
# 必要なもの:
#   - supabase CLI(pnpm dlx supabase だと毎回インストールで遅いので
#     ローカルインストール推奨:`brew install supabase/tap/supabase`)
#   - Supabase アクセストークン(`supabase login` を一度)
#
# CLAUDE.md ルール:
#   - 本スクリプトは default で dev に向ける(maira-dev = pfebbpgcufintmulhydg)
#   - prod を指定する場合は明示的に DB_PROJECT_REF=xxatkimjfiaidxfuglae
#     を渡す必要があり、operate ミスを防ぐためあえて非デフォルトにしている
# =====================================================================

set -euo pipefail

PROJECT_REF="${DB_PROJECT_REF:-pfebbpgcufintmulhydg}"
OUTPUT="lib/supabase/database.types.ts"

echo "Generating Supabase types from project: $PROJECT_REF"
echo "Output: $OUTPUT"

# supabase CLI が無ければ案内して終了
if ! command -v supabase >/dev/null 2>&1; then
  echo "[Error] supabase CLI が見つかりません。"
  echo "  brew install supabase/tap/supabase"
  echo "  または npx supabase ... を直接使ってください。"
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"

# 型生成
supabase gen types typescript \
  --project-id "$PROJECT_REF" \
  --schema public \
  > "$OUTPUT"

echo "✓ 型ファイルを生成しました: $OUTPUT"
echo "次のステップ:"
echo "  1) lib/supabase/server.ts / client.ts で Database 型を import"
echo "  2) createClient<Database>() に型引数を付ける"
echo "  3) 既存の \`as unknown as\` キャストを段階的に削除"
