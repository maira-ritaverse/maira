import { describe, expect, it } from "vitest";

import type { ClientExtractionResult } from "@/lib/ai/prompts/client-extract-from-document";

import { clientExtractionToEducationHistory } from "./client-record-to-document";

// clientExtractionToEducationHistory は education_detail と work_history_detail のみ読むため、
// 単体テストでは最小限のフィールドだけ持つオブジェクトを cast して渡す。
const ext = (o: Partial<ClientExtractionResult>): ClientExtractionResult =>
  ({ education_detail: "", work_history_detail: "", ...o }) as ClientExtractionResult;

describe("clientExtractionToEducationHistory", () => {
  it("学歴のみ:見出しなしで学歴行だけ返す", () => {
    const rows = clientExtractionToEducationHistory(
      ext({ education_detail: "2015/4 ○○大学 経済学部 入学\n2019/3 ○○大学 経済学部 卒業" }),
    );
    expect(rows).toEqual([
      { year: "2015/4", description: "○○大学 経済学部 入学" },
      { year: "2019/3", description: "○○大学 経済学部 卒業" },
    ]);
  });

  it("職歴のみ:見出しなしで職歴行だけ返す", () => {
    const rows = clientExtractionToEducationHistory(
      ext({ work_history_detail: "2019/4 株式会社ABC 入社" }),
    );
    expect(rows).toEqual([{ year: "2019/4", description: "株式会社ABC 入社" }]);
  });

  it("学歴+職歴:見出し行「学歴」「職歴」を挟んで統合する(職歴が反映される)", () => {
    const rows = clientExtractionToEducationHistory(
      ext({
        education_detail: "2019/3 ○○大学 卒業",
        work_history_detail: "2019/4 株式会社ABC 入社\n2023/3 株式会社ABC 退社",
      }),
    );
    expect(rows).toEqual([
      { year: "", description: "学歴" },
      { year: "2019/3", description: "○○大学 卒業" },
      { year: "", description: "職歴" },
      { year: "2019/4", description: "株式会社ABC 入社" },
      { year: "2023/3", description: "株式会社ABC 退社" },
    ]);
  });

  it("空:空配列を返す", () => {
    expect(clientExtractionToEducationHistory(ext({}))).toEqual([]);
  });
});
