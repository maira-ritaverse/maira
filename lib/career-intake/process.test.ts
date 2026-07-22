import { describe, expect, it } from "vitest";

import { looksLikeNoSpeech } from "./process";

describe("looksLikeNoSpeech(無音/ハルシネーション検出)", () => {
  it("Whisper 無音ハルシネーション(『ご視聴ありがとうございました』連呼)は無発話と判定", () => {
    const text = Array.from({ length: 40 }, () => "ご視聴ありがとうございました").join(" ");
    expect(looksLikeNoSpeech(text)).toBe(true);
  });

  it("空 / 極端に短い文字起こしは無発話", () => {
    expect(looksLikeNoSpeech("")).toBe(true);
    expect(looksLikeNoSpeech("あ、はい。")).toBe(true);
  });

  it("実際の面談文字起こし(職歴・希望などを含む)は無発話にしない", () => {
    const text =
      "はい、よろしくお願いします。前職では株式会社サンプルで営業を5年ほど担当していました。" +
      "主に新規開拓を行い、年間で売上を120%達成しました。転職を考えた理由は、より裁量の大きい環境で" +
      "挑戦したいと思ったからです。希望としては、IT業界のカスタマーサクセス職を考えています。" +
      "最後までありがとうございました。";
    expect(looksLikeNoSpeech(text)).toBe(false);
  });

  it("末尾に定型のお礼があっても、実内容があれば無発話にしない", () => {
    const text =
      "エンジニアとして3年間、Webアプリの開発をしていました。ReactとTypeScriptが得意です。ありがとうございました。";
    expect(looksLikeNoSpeech(text)).toBe(false);
  });
});
