/**
 * 既存の career_intake_recordings.extraction(ExtractionResult)を
 * hearing_sheets.content(HearingSheetContent)に取り込むためのマッピング。
 *
 * 設計判断:
 *   ・AI 抽出の自由度の高い項目(workExperiences / skills / careerSummary 等)
 *     はヒアリングシートの「current_job」「strengths」「notes」に文章として
 *     畳み込む。構造化フィールドは失われる代わりに、エージェントが面談中に
 *     即読み・即修正できるサマリ形式に整える。
 *   ・希望条件(desiredIndustries / Occupations / Locations / Income)は
 *     ヒアリングシートの desired_* に「、」区切りで集約。
 *   ・既存値がある項目は上書きしない(AI と人手の混在を尊重)。
 *     呼び出し側が「現状の content」と「抽出値」を渡し、本関数が新しい
 *     content を返す純粋関数。
 */
import type { ExtractionResult } from "@/lib/career-intake/types";

import type { HearingSheetContent } from "./types";

const overrideIfEmpty = (current: string, next: string): string => {
  if (current.trim().length > 0) return current;
  return next;
};

const joinList = (items: string[] | undefined): string => (items ?? []).filter(Boolean).join("、");

function describeWorkExperiences(extraction: ExtractionResult): string {
  const lines: string[] = [];
  if (extraction.careerSummary) lines.push(extraction.careerSummary);
  for (const w of extraction.workExperiences ?? []) {
    const period = formatPeriod(w.startYear, w.startMonth, w.endYear, w.endMonth);
    const head = [period, w.companyName, w.position ?? ""].filter(Boolean).join(" / ");
    if (head) lines.push(head);
    if (w.jobDescription) lines.push(`  業務:${w.jobDescription}`);
    if (w.achievements) lines.push(`  実績:${w.achievements}`);
  }
  return lines.join("\n");
}

function describeSkills(extraction: ExtractionResult): string {
  if (extraction.skillsSummary) return extraction.skillsSummary;
  const names = (extraction.skills ?? []).map((s) => s.name).filter(Boolean);
  return names.join("、");
}

function formatPeriod(
  startYear: number | null | undefined,
  startMonth: number | null | undefined,
  endYear: number | null | undefined,
  endMonth: number | null | undefined,
): string {
  const fmt = (y: number | null | undefined, m: number | null | undefined): string => {
    if (!y) return "";
    return m ? `${y}/${String(m).padStart(2, "0")}` : `${y}`;
  };
  const s = fmt(startYear, startMonth);
  const e = fmt(endYear, endMonth);
  if (!s && !e) return "";
  return `${s}〜${e}`;
}

/**
 * AI 抽出結果を ヒアリングシート content にマージする。
 * 既存テキストがあるフィールドは温存し、空欄だけ AI で埋める。
 */
export function mergeExtractionIntoHearing(
  current: HearingSheetContent,
  extraction: ExtractionResult,
): HearingSheetContent {
  const workSummary = describeWorkExperiences(extraction);
  const skills = describeSkills(extraction);

  return {
    current_job: overrideIfEmpty(current.current_job, workSummary),
    strengths: overrideIfEmpty(current.strengths, skills),
    weaknesses: current.weaknesses, // AI からは抽出しない方針
    desired_industry: overrideIfEmpty(
      current.desired_industry,
      joinList(extraction.desiredIndustries),
    ),
    desired_position: overrideIfEmpty(
      current.desired_position,
      joinList(extraction.desiredOccupations),
    ),
    desired_location: overrideIfEmpty(
      current.desired_location,
      joinList(extraction.desiredLocations),
    ),
    desired_salary: overrideIfEmpty(
      current.desired_salary,
      extraction.desiredAnnualIncome != null ? `${extraction.desiredAnnualIncome} 万円` : "",
    ),
    job_change_reason: current.job_change_reason, // AI 出力に明示マッピング項目なし
    motivation: overrideIfEmpty(current.motivation, extraction.motivationNote ?? ""),
    availability: current.availability,
    notes: overrideIfEmpty(
      current.notes,
      [
        extraction.nameKana ? `氏名カナ:${extraction.nameKana}` : "",
        extraction.birthDate ? `生年月日:${extraction.birthDate}` : "",
        extraction.selfPr ? `自己 PR:${extraction.selfPr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  };
}
