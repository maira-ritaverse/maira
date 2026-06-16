import { describe, expect, it } from "vitest";

import { extractJsonFromText } from "./extract-json";

describe("extractJsonFromText", () => {
  it("純粋な JSON はそのまま", () => {
    const json = '{"a":1}';
    expect(extractJsonFromText(json)).toBe(json);
  });

  it("コードフェンス内の JSON を抽出(```json ... ```)", () => {
    const text = '結果:\n```json\n{"a":1}\n```\n以上です。';
    expect(extractJsonFromText(text)).toBe('{"a":1}');
  });

  it("コードフェンス内の JSON を抽出(``` ... ```、言語名なし)", () => {
    const text = '```\n{"a":1}\n```';
    expect(extractJsonFromText(text)).toBe('{"a":1}');
  });

  it("前置きがあっても先頭 { から最後の } を切り出し", () => {
    const text = '結果は以下のとおりです:\n{"a":1,"b":2}\n何か質問があればどうぞ。';
    expect(extractJsonFromText(text)).toBe('{"a":1,"b":2}');
  });

  it("入れ子オブジェクトは最後の } まで含める", () => {
    const text = '{"outer":{"inner":1}}';
    expect(extractJsonFromText(text)).toBe('{"outer":{"inner":1}}');
  });

  it("{} が無いテキストはそのまま返す(呼び出し側で JSON.parse 失敗)", () => {
    expect(extractJsonFromText("not json at all")).toBe("not json at all");
  });

  it("コードフェンス優先(本文に余分な } があっても影響なし)", () => {
    const text = 'こんなに変な } 文字があっても\n```json\n{"a":1}\n```\n大丈夫';
    expect(extractJsonFromText(text)).toBe('{"a":1}');
  });
});
