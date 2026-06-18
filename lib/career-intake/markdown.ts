/**
 * 抽出結果(ExtractionResult)を Markdown 形式の人間可読テキストに変換する純関数。
 *
 * - 同じデータを履歴書 / 職務経歴書 / 共有リンク等の各場面で再利用しやすくする
 * - 改行は LF 固定。BOM は付けない
 * - 「エクスポート」「コピーボタン」両方で使う想定
 */
import type { ExtractionResult } from "./types";

export function extractionToMarkdown(
  ext: ExtractionResult,
  options: { title?: string } = {},
): string {
  const lines: string[] = [];
  const title = options.title ?? "キャリアサマリ";
  lines.push(`# ${title}`);
  lines.push("");

  if (ext.careerSummary) {
    lines.push("## 職務サマリ");
    lines.push(ext.careerSummary.trim());
    lines.push("");
  }
  if (ext.selfPr) {
    lines.push("## 自己 PR");
    lines.push(ext.selfPr.trim());
    lines.push("");
  }
  if (ext.motivationNote) {
    lines.push("## 志望動機メモ");
    lines.push(ext.motivationNote.trim());
    lines.push("");
  }

  if (ext.workExperiences.length > 0) {
    lines.push("## 職務経歴");
    for (const w of ext.workExperiences) {
      const period = fmtPeriodRange(
        w.startYear ?? null,
        w.startMonth ?? null,
        w.endYear ?? null,
        w.endMonth ?? null,
      );
      const meta = [w.industry, w.position].filter(Boolean).join(" / ");
      // 会社名が抽出できなかった場合は明示的なフォールバック表示にする
      // (null / 空のときに "### undefined" のような壊れた見出しになるのを防ぐ)
      const companyLabel = w.companyName?.trim() || "(社名不明)";
      lines.push(`### ${companyLabel}`);
      if (meta) lines.push(`- ${meta}`);
      if (period) lines.push(`- ${period}`);
      if (w.jobDescription) {
        lines.push("");
        lines.push("**業務内容:**");
        lines.push(w.jobDescription.trim());
      }
      if (w.achievements) {
        lines.push("");
        lines.push("**実績:**");
        lines.push(w.achievements.trim());
      }
      lines.push("");
    }
  }

  if (ext.educationHistory.length > 0) {
    lines.push("## 学歴");
    for (const e of ext.educationHistory) {
      lines.push(`- ${fmtYM(e.year, e.month)}: ${e.description}`);
    }
    lines.push("");
  }
  if (ext.workHistory.length > 0) {
    lines.push("## 職歴(時系列)");
    for (const e of ext.workHistory) {
      lines.push(`- ${fmtYM(e.year, e.month)}: ${e.description}`);
    }
    lines.push("");
  }
  if (ext.licenses.length > 0) {
    lines.push("## 資格 / ライセンス");
    for (const l of ext.licenses) {
      lines.push(`- ${fmtYM(l.year, l.month)}: ${l.name}`);
    }
    lines.push("");
  }

  if (ext.skills.length > 0) {
    lines.push("## スキル");
    for (const s of ext.skills) {
      const tag = s.level ? ` (${s.level})` : "";
      lines.push(`- ${s.name}${tag}`);
    }
    lines.push("");
  }
  if (ext.skillsSummary) {
    lines.push("## スキル(文章)");
    lines.push(ext.skillsSummary.trim());
    lines.push("");
  }

  const desired: string[] = [];
  if (ext.desiredIndustries.length > 0) desired.push(`業界: ${ext.desiredIndustries.join(", ")}`);
  if (ext.desiredOccupations.length > 0) desired.push(`職種: ${ext.desiredOccupations.join(", ")}`);
  if (ext.desiredLocations.length > 0) desired.push(`勤務地: ${ext.desiredLocations.join(", ")}`);
  if (ext.desiredAnnualIncome != null) desired.push(`希望年収: ${ext.desiredAnnualIncome} 万円`);
  if (desired.length > 0) {
    lines.push("## 希望条件");
    for (const d of desired) lines.push(`- ${d}`);
    lines.push("");
  }

  return lines.join("\n");
}

function fmtYM(year: number | null, month: number | null): string {
  if (year == null && month == null) return "?";
  if (year != null && month != null) return `${year}年${month}月`;
  if (year != null) return `${year}年`;
  return "?";
}

function fmtPeriodRange(
  startYear: number | null,
  startMonth: number | null,
  endYear: number | null,
  endMonth: number | null,
): string {
  const start = fmtYM(startYear, startMonth);
  const hasStart = start !== "?";
  if (!hasStart && endYear == null) return "";
  const end = endYear == null && endMonth == null ? "現在" : fmtYM(endYear, endMonth);
  return `${start} 〜 ${end}`;
}
