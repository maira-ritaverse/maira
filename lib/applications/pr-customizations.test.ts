import { describe, expect, it } from "vitest";

import { applyCvOverrides, applyResumeOverrides, prOverridesSchema } from "./pr-customizations";
import type { CvBody } from "@/lib/cvs/types";
import type { Resume } from "@/lib/resumes/types";

// テスト用ミニマム履歴書(必須フィールドだけ埋める)
const baseResume: Resume = {
  id: "r1",
  userId: "u1",
  title: "履歴書",
  name: null,
  nameKana: null,
  birthDate: null,
  gender: null,
  postalCode: null,
  address: null,
  addressKana: null,
  phone: null,
  email: null,
  contactAddress: null,
  contactAddressKana: null,
  contactPhone: null,
  photoUrl: null,
  documentDate: null,
  educationHistory: [],
  licenses: [],
  motivationNote: "元の志望動機(履歴書本体)",
  personalRequests: null,
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

const baseCvBody: CvBody = {
  summary: "Web ディレクターとしての要約",
  work_experiences: [],
  skills: [],
  self_pr: "元の自己PR(職務経歴書本体)",
};

describe("applyResumeOverrides", () => {
  it("override が空なら motivationNote を維持する", () => {
    const r = applyResumeOverrides(baseResume, {});
    expect(r.motivationNote).toBe("元の志望動機(履歴書本体)");
  });

  it("motivation_note のみある時はそれで上書き", () => {
    const r = applyResumeOverrides(baseResume, { motivation_note: "応募用の志望動機" });
    expect(r.motivationNote).toBe("応募用の志望動機");
  });

  it("self_pr のみある時はそれで上書き", () => {
    const r = applyResumeOverrides(baseResume, { self_pr: "応募用の自己PR" });
    expect(r.motivationNote).toBe("応募用の自己PR");
  });

  it("両方ある時は改行 2 つで連結する", () => {
    const r = applyResumeOverrides(baseResume, {
      motivation_note: "応募用の志望動機",
      self_pr: "応募用の自己PR",
    });
    expect(r.motivationNote).toBe("応募用の志望動機\n\n応募用の自己PR");
  });

  it("空文字 / 空白だけは未設定扱いで本体を維持", () => {
    const r = applyResumeOverrides(baseResume, {
      motivation_note: "   ",
      self_pr: "",
    });
    expect(r.motivationNote).toBe("元の志望動機(履歴書本体)");
  });

  it("他のフィールドには影響しない", () => {
    const r = applyResumeOverrides(baseResume, { motivation_note: "X" });
    expect(r.title).toBe(baseResume.title);
    expect(r.educationHistory).toBe(baseResume.educationHistory);
    expect(r.licenses).toBe(baseResume.licenses);
  });
});

describe("applyCvOverrides", () => {
  it("override が空なら body.self_pr を維持", () => {
    const b = applyCvOverrides(baseCvBody, {});
    expect(b.self_pr).toBe("元の自己PR(職務経歴書本体)");
  });

  it("cv_self_pr で上書き", () => {
    const b = applyCvOverrides(baseCvBody, { cv_self_pr: "応募用の職務経歴書 自己PR" });
    expect(b.self_pr).toBe("応募用の職務経歴書 自己PR");
  });

  it("空白だけは本体維持", () => {
    const b = applyCvOverrides(baseCvBody, { cv_self_pr: "   " });
    expect(b.self_pr).toBe("元の自己PR(職務経歴書本体)");
  });

  it("summary / work_experiences / skills には影響しない", () => {
    const b = applyCvOverrides(baseCvBody, { cv_self_pr: "X" });
    expect(b.summary).toBe(baseCvBody.summary);
    expect(b.work_experiences).toBe(baseCvBody.work_experiences);
    expect(b.skills).toBe(baseCvBody.skills);
  });
});

describe("prOverridesSchema", () => {
  it("cv_self_pr フィールドを受け入れる", () => {
    const r = prOverridesSchema.safeParse({ cv_self_pr: "テスト" });
    expect(r.success).toBe(true);
  });

  it("cv_self_pr 上限 2000 字を超えると弾く", () => {
    const r = prOverridesSchema.safeParse({ cv_self_pr: "あ".repeat(2001) });
    expect(r.success).toBe(false);
  });
});
