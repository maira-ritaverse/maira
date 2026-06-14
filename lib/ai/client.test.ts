import { describe, it, expect } from "vitest";
import { MODELS } from "./client";

/**
 * AI モデル定義の構造テスト。
 *
 * MODELS は全モジュール共通で参照される単一情報源。CONVERSATION を変えると
 * キャリア棚卸し / 書類生成 / 応募アドバイザー / 診断説明 すべての出力品質に
 * 影響する。誰かが Sonnet → Haiku のような大きなダウングレードを入れたら
 * テストで気付けるよう、現行値を直接 assert で固定する。
 *
 * Anthropic モデル名は claude-{tier}-{major}-{minor} の規約に従う前提
 * (claude-sonnet-4-6 / claude-haiku-4-5 等)。
 */

describe("MODELS", () => {
  it("CONVERSATION は claude-sonnet-4-6(メイン会話モデル)", () => {
    expect(MODELS.CONVERSATION).toBe("claude-sonnet-4-6");
  });

  it("LIGHT は claude-haiku-4-5(軽量タスク用)", () => {
    expect(MODELS.LIGHT).toBe("claude-haiku-4-5");
  });

  it("モデル名は Anthropic の規約('claude-' で始まる)に従う", () => {
    for (const id of Object.values(MODELS)) {
      expect(id).toMatch(/^claude-/);
    }
  });

  it("各モデルは tier(sonnet/haiku/opus 等)とバージョンを含む", () => {
    // claude-{tier}-{major}-{minor} のパターン
    for (const id of Object.values(MODELS)) {
      expect(id).toMatch(/^claude-[a-z]+-\d+-\d+$/);
    }
  });

  it("2 モデルが定義されている(CONVERSATION / LIGHT)", () => {
    expect(Object.keys(MODELS).sort()).toEqual(["CONVERSATION", "LIGHT"]);
  });
});
