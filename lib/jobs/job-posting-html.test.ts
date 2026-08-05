/**
 * 求人票 PDF 用 HTML テンプレートの 回帰テスト
 *
 * 主眼は「長文セクションが 改ページで 崩れない(= 空白の 大穴が できない)」
 * ための CSS / マークアップ 契約を 固定する こと。
 * 実際の PDF ピクセルは 検証できない ため、崩れを 生む 原因だった
 *   ・セクション本文行の page-break 設定
 *   ・見出し行の orphan 回避
 * を マークアップ / CSS 文字列 レベルで 担保する。
 */
import { describe, expect, it } from "vitest";

import { buildJobPostingHtml } from "@/lib/jobs/job-posting-html";
import type { JobPosting } from "@/lib/jobs/types";

const baseJob: JobPosting = {
  id: "j1",
  organizationId: "o1",
  companyName: "株式会社テスト",
  position: "セールス",
  employmentType: "正社員",
  location: "東京都",
  salaryMin: 400,
  salaryMax: 600,
  description: "★ 仕事内容\n新規営業を お任せします。",
  requiredSkills: null,
  preferredSkills: null,
  status: "open",
  workChangeScope: null,
  locationChangeScope: null,
  smokingPreventionMeasure: null,
  probationPeriod: null,
  workHours: null,
  breakTime: null,
  holidays: null,
  applicationQualifications: null,
  heroImagePath: null,
  lineShareImagePath: null,
  placementFee: null,
  createdByMemberId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("buildJobPostingHtml", () => {
  it("採用企業名 / 求人名 を 描画する", () => {
    const html = buildJobPostingHtml({ job: baseJob });
    expect(html).toContain("株式会社テスト");
    expect(html).toContain("セールス");
  });

  it("発行元(agencyName)を 採用企業名と 別枠で 出す", () => {
    const html = buildJobPostingHtml({ job: baseJob, agencyName: "株式会社chemin" });
    expect(html).toContain("発行: 株式会社chemin");
  });

  it("セクション本文行は 改ページ可(page-break-inside: auto)で 大穴を 防ぐ", () => {
    const html = buildJobPostingHtml({ job: baseJob });
    // 本文が 1 ページに 収まらない とき 行ごと 次ページへ 飛ぶ 崩れを 防ぐ 契約。
    expect(html).toContain("tr.section-row { page-break-inside: auto; }");
    // セクション本文行に 実際に class が 付いている。
    expect(html).toMatch(/<tr class="section-row"><td class="section-body">/);
  });

  it("セクション見出し行は 直後の 本文と 一緒に 送る(orphan 回避)", () => {
    const html = buildJobPostingHtml({ job: baseJob });
    expect(html).toContain("tr.section-head-row { break-after: avoid; page-break-after: avoid; }");
    expect(html).toMatch(/<tr class="section-head-row"><td class="section-head">/);
  });

  it("値が 空の 項目は 「—」の プレースホルダを 出す(行は 残す)", () => {
    const html = buildJobPostingHtml({ job: baseJob });
    // 福利厚生 等 空セクションは 空セルの 行を 残す。
    expect(html).toContain('<span class="empty">—</span>');
  });
});
