import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 設定。
 *
 * TS の tsconfig.json で `@/*` → `./*` を切っているため、
 * Vitest 側にも同じエイリアスを通す必要がある。
 * 通っていないと `Cannot find package '@/lib/...'` で落ちる。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    // Playwright E2E は別ランナー(@playwright/test)で実行するため除外。
    // 拡張子は同じだが、e2e/ ディレクトリ自体を spec の対象外にする。
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      // 対象は実装ファイルのみ。設定 / テスト / マイグレーション / 自動生成は除外。
      include: ["lib/**/*.ts", "app/**/*.ts", "app/**/*.tsx", "components/**/*.tsx"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "**/types.ts", // 型定義のみ
        "scripts/**",
        "supabase/**",
        "e2e/**",
        "**/node_modules/**",
      ],
      // 当面のしきい値:既存実装の品質に合わせて緩めにスタート。
      // 段階的に上げる前提で、最初は下回ったら警告だけ出す(failOnLow=false)。
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
});
