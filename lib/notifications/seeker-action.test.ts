import { describe, expect, it } from "vitest";

import { _internal } from "./seeker-action";

const { buildTitle } = _internal;

describe("buildTitle (seeker action notification)", () => {
  it("seeker_job_interest は「興味あり」表現", () => {
    expect(buildTitle("seeker_job_interest", "山田太郎", "株式会社X ・ PdM")).toBe(
      "山田太郎 さんが「株式会社X ・ PdM」に興味あり",
    );
  });

  it("seeker_application_request は「応募を依頼」表現", () => {
    expect(buildTitle("seeker_application_request", "山田太郎", "株式会社X ・ PdM")).toBe(
      "山田太郎 さんが「株式会社X ・ PdM」への応募を依頼",
    );
  });

  it("client name / job label が title に含まれる", () => {
    const t = buildTitle("seeker_job_interest", "佐藤花子", "Y社 ・ デザイナー");
    expect(t).toContain("佐藤花子");
    expect(t).toContain("Y社 ・ デザイナー");
  });

  it("プライバシー:notes 等の内部情報を含む文字列は title 生成側で混入させない", () => {
    // タイトル生成は引数だけで決まるので、内面情報を含まないことを設計レベルで担保
    const t = buildTitle("seeker_job_interest", "X", "Y");
    expect(t).not.toContain("notes");
    expect(t).not.toContain("encrypted");
    expect(t).not.toContain("diagnosis");
  });
});
