/**
 * career_intake_recordings.extraction(ExtractionResult)を
 * AgencyClientResume / AgencyClientCv の初期データに変換するマッパー。
 *
 * 設計判断:
 *   ・本ファイルは「空の状態に AI 抽出を流し込む」用途を想定。merge は
 *     呼び出し側 API ルートで「既存値を温存する場合は overrideIfEmpty」のように
 *     使い分ける。lib/agency-client-documents/extraction-to-hearing.ts の方針と統一。
 *   ・抽出側にしか無い情報(workExperiences の構造化、skills 等)は CV 本文へ
 *     段落化して投入する(履歴書側は氏名カナ / 生年月日 / 学歴+職歴 / 資格 /
 *     志望動機 / 自己 PR / 希望条件 に限定して投入)。
 *   ・抽出に氏名や住所が含まれないため、履歴書本体の full_name は呼び出し
 *     側で client.name を fallback で埋める。
 */
import type { ExtractionResult } from "@/lib/career-intake/types";

import type {
  CvBody,
  EducationItem as AgencyEducationItem,
  LicenseItem as AgencyLicenseItem,
  ResumePii,
} from "./types";

const overrideIfEmpty = (current: string, next: string): string => {
  if (current.trim().length > 0) return current;
  return next;
};

const joinList = (items: string[] | undefined): string => (items ?? []).filter(Boolean).join("、");

const formatYearMonth = (
  year: number | null | undefined,
  month: number | null | undefined,
): string => {
  if (!year) return "";
  return month ? `${year}/${String(month).padStart(2, "0")}` : `${year}`;
};

// ───────────────────────────────────────────────────────────────────
// 履歴書 PII への マージ
// ───────────────────────────────────────────────────────────────────

export function mergeExtractionIntoResumePii(
  current: ResumePii,
  extraction: ExtractionResult,
  fallbackName: string,
): ResumePii {
  return {
    full_name: overrideIfEmpty(current.full_name, fallbackName),
    full_name_kana: overrideIfEmpty(current.full_name_kana, extraction.nameKana ?? ""),
    birth_date: overrideIfEmpty(current.birth_date, normalizeBirthDate(extraction.birthDate)),
    gender: current.gender, // 抽出からは決定しない
    postal_code: current.postal_code,
    address: current.address,
    // address_kana は録音抽出では扱わないが、既存値(書類/プロフィール由来のフリガナ)を保持する。
    // (optional 化に伴い、ここで落とすと保存時に現住所フリガナが消える不具合になるため明示保持)
    address_kana: current.address_kana,
    phone: current.phone,
    email: current.email,
    motivation: overrideIfEmpty(current.motivation, extraction.motivationNote ?? ""),
    self_pr: overrideIfEmpty(current.self_pr, extraction.selfPr ?? ""),
    preferences: overrideIfEmpty(current.preferences, buildPreferences(extraction)),
  };
}

function normalizeBirthDate(raw: string | null | undefined): string {
  if (!raw) return "";
  // 既に YYYY-MM-DD っぽければそのまま
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return "";
}

function buildPreferences(extraction: ExtractionResult): string {
  const lines: string[] = [];
  const industries = joinList(extraction.desiredIndustries);
  const occupations = joinList(extraction.desiredOccupations);
  const locations = joinList(extraction.desiredLocations);
  if (industries) lines.push(`希望業種:${industries}`);
  if (occupations) lines.push(`希望職種:${occupations}`);
  if (locations) lines.push(`希望勤務地:${locations}`);
  if (extraction.desiredAnnualIncome != null) {
    lines.push(`希望年収:${extraction.desiredAnnualIncome} 万円`);
  }
  return lines.join("\n");
}

// ───────────────────────────────────────────────────────────────────
// 履歴書 学歴・職歴 / 資格 への マージ
// ───────────────────────────────────────────────────────────────────

/**
 * 抽出の学歴(educationHistory)と職歴(workHistory)を統合して、
 * 履歴書様式の「学歴・職歴」配列に整形する。
 * 既存項目があればそれをベースに、重複を避けて末尾追加する。
 */
export function mergeExtractionIntoEducation(
  current: AgencyEducationItem[],
  extraction: ExtractionResult,
): AgencyEducationItem[] {
  const fromExtraction: AgencyEducationItem[] = [];
  for (const e of extraction.educationHistory ?? []) {
    fromExtraction.push({
      year: formatYearMonth(e.year, e.month),
      description: e.description,
    });
  }
  // workHistory も同じ形式に
  for (const w of extraction.workHistory ?? []) {
    fromExtraction.push({
      year: formatYearMonth(w.year, w.month),
      description: w.description,
    });
  }
  return dedupeByDescription(current, fromExtraction);
}

export function mergeExtractionIntoLicenses(
  current: AgencyLicenseItem[],
  extraction: ExtractionResult,
): AgencyLicenseItem[] {
  const fromExtraction: AgencyLicenseItem[] = (extraction.licenses ?? []).map((l) => ({
    year: formatYearMonth(l.year, l.month),
    description: l.name,
  }));
  return dedupeByDescription(current, fromExtraction);
}

function dedupeByDescription<T extends { description: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((c) => c.description.trim()));
  const out = [...current];
  for (const it of incoming) {
    const key = it.description.trim();
    if (!key || seen.has(key)) continue;
    out.push(it);
    seen.add(key);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────
// 職務経歴書 本文への マージ
// ───────────────────────────────────────────────────────────────────

/**
 * 抽出結果を CV body(summary + body)に変換する。
 * 既存値は overrideIfEmpty で温存する。
 */
export function mergeExtractionIntoCvBody(current: CvBody, extraction: ExtractionResult): CvBody {
  const summary = overrideIfEmpty(current.summary, extraction.careerSummary ?? "");
  const body = overrideIfEmpty(current.body, buildCvBodyText(extraction));
  return { summary, body };
}

function buildCvBodyText(extraction: ExtractionResult): string {
  const sections: string[] = [];

  // 職務経歴(workExperiences を時系列でブロック化)
  if (extraction.workExperiences && extraction.workExperiences.length > 0) {
    const lines: string[] = ["【職務経歴】"];
    for (const w of extraction.workExperiences) {
      const period = formatPeriod(w.startYear, w.startMonth, w.endYear, w.endMonth);
      const head = [period, w.companyName, w.position ?? ""].filter(Boolean).join(" / ");
      if (head) lines.push(head);
      if (w.industry) lines.push(`  業界:${w.industry}`);
      if (w.jobDescription) lines.push(`  業務:${w.jobDescription}`);
      if (w.achievements) lines.push(`  実績:${w.achievements}`);
      lines.push("");
    }
    sections.push(lines.join("\n").trimEnd());
  }

  // スキル
  if (extraction.skills && extraction.skills.length > 0) {
    const lines: string[] = ["【スキル】"];
    for (const s of extraction.skills) {
      const level = s.level ? `(${labelSkillLevel(s.level)})` : "";
      lines.push(`  ・${s.name}${level}`);
    }
    sections.push(lines.join("\n"));
  } else if (extraction.skillsSummary) {
    sections.push(`【スキル】\n${extraction.skillsSummary}`);
  }

  // 自己 PR
  if (extraction.selfPr) {
    sections.push(`【自己 PR】\n${extraction.selfPr}`);
  }

  return sections.join("\n\n");
}

function labelSkillLevel(level: "basic" | "intermediate" | "advanced"): string {
  switch (level) {
    case "basic":
      return "初級";
    case "intermediate":
      return "中級";
    case "advanced":
      return "上級";
  }
}

function formatPeriod(
  startYear: number | null | undefined,
  startMonth: number | null | undefined,
  endYear: number | null | undefined,
  endMonth: number | null | undefined,
): string {
  const s = formatYearMonth(startYear, startMonth);
  const e = formatYearMonth(endYear, endMonth);
  if (!s && !e) return "";
  return `${s}〜${e}`;
}
