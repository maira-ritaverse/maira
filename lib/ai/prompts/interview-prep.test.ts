import { describe, it, expect } from "vitest";

import { parseInterviewPrepOutput } from "./interview-prep";

describe("parseInterviewPrepOutput", () => {
  const valid = JSON.stringify({
    sections: [
      { heading: "この企業・求人を研究するポイント", items: ["A", "B"] },
      { heading: "想定される質問と回答の方向性", items: ["C"] },
    ],
  });

  it("素の JSON をパースできる", () => {
    const r = parseInterviewPrepOutput(valid);
    expect(r.sections).toHaveLength(2);
    expect(r.sections[0].heading).toBe("この企業・求人を研究するポイント");
    expect(r.sections[0].items).toEqual(["A", "B"]);
  });

  it("コードフェンス付きでも中身を拾える", () => {
    const r = parseInterviewPrepOutput("```json\n" + valid + "\n```");
    expect(r.sections).toHaveLength(2);
  });

  it("前後に説明文があっても最初の { から最後の } を拾う", () => {
    const r = parseInterviewPrepOutput("以下が面接対策です。\n" + valid + "\n以上です。");
    expect(r.sections).toHaveLength(2);
  });

  it("空 items / 空 heading のセクションは除外する", () => {
    const r = parseInterviewPrepOutput(
      JSON.stringify({
        sections: [
          { heading: "有効", items: ["x"] },
          { heading: "", items: [] },
          { heading: "見出しのみ", items: [] },
        ],
      }),
    );
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].heading).toBe("有効");
  });

  it("壊れた JSON はフェイルオープンで 1 セクションに収める", () => {
    const r = parseInterviewPrepOutput("これは JSON ではありません");
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].heading).toBe("面接対策");
    expect(r.sections[0].items[0]).toContain("これは JSON ではありません");
  });
});
