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
});
