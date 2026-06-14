import { escapeHtml } from "@/lib/html/escape";
import {
  employmentTypeLabels,
  skillCategories,
  skillCategoryLabels,
  skillLevelLabels,
  type CvBody,
  type PeriodPoint,
  type Skill,
  type SkillCategory,
  type WorkExperience,
} from "./types";
import type { LicenseItem } from "@/lib/resumes/types";

/**
 * 職務経歴書(JIS様式想定、ブロック型レイアウト)の PDF 用 HTML 文字列ビルダー
 *
 * components/features/cv/cv-preview.tsx と同じレイアウトを、Puppeteer に渡せる
 * 「完全な HTML 文字列」として生成する。React レンダリングではなく
 * テンプレートリテラルで組み立てる(Puppeteer の page.setContent に渡すため)。
 *
 * 設計方針(履歴書 lib/resumes/resume-html.ts と同型):
 * - 日本語フォントは Google Fonts の Noto Serif JP を埋め込む(豆腐 □□□ 対策)
 * - 文字列を埋め込むときは必ず escapeHtml を通す
 *   (XSS / 不正な </body> 等で Puppeteer 内のスクリプト実行・PDF 破損を防ぐ)
 * - 履歴書と違って職務経歴書は内容量が可変。固定の「○ページ目」構造ではなく
 *   自然なフローレイアウトにして、@page の自動改ページに任せる
 *
 * 改ページ制御(Phase 3 の要点):
 * - @page で A4 と余白を指定(マージン 15mm)
 * - 各職歴ブロック(.work-block)に page-break-inside: avoid + break-inside: avoid
 *   → 職歴 1 件が途中で次ページに割れない(2 件目から次ページ)
 * - セクション見出しに page-break-after: avoid + break-after: avoid
 *   → 見出しだけ前ページに残る「孤児見出し」を防ぐ
 * - 資格テーブル(.license-table)の行にも break-inside: avoid
 */

type Options = {
  body: CvBody;
  // 履歴書から引いてきた氏名(null = 履歴書未選択 or 未入力)
  name: string | null;
  // 履歴書から引いてきた資格一覧(履歴書未選択 or 履歴書側で資格未登録なら [])
  licenses: LicenseItem[];
  // CV.documentDate(null なら本日にフォールバック)
  documentDate: string | null;
  // HTML <title>(ブラウザタブ等の表記用。ファイル名は PDF API 側で別途付ける)
  title: string;
};

export function buildCvHtml(opts: Options): string {
  const { body, name, licenses, documentDate, title } = opts;
  const today = formatDocumentDate(documentDate);

  const workExperiencesHtml = body.work_experiences.length
    ? body.work_experiences.map(renderWorkExperience).join("\n")
    : `<p class="empty-hint">(未入力)</p>`;

  const skillsHtml = body.skills.length
    ? renderSkills(body.skills)
    : `<p class="empty-hint">(未入力)</p>`;

  const licensesHtml = licenses.length
    ? renderLicenses(licenses)
    : `<p class="empty-hint">${
        name !== null
          ? "(参照中の履歴書に資格が登録されていません)"
          : "(履歴書を選択すると資格が反映されます)"
      }</p>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  /* ===== ページ設定 ===== */
  /* @page でページ余白を取り、本文側は padding を持たない(二重マージン防止)。
     職務経歴書は内容可変なので履歴書のような「.page を縦に積む」構造は使わず、
     自然なフローレイアウトに自動改ページを任せる。 */
  @page {
    size: A4;
    margin: 15mm;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    color: #000;
    background: #fff;
    font-family: "Noto Serif JP", "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif;
    font-size: 12px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ===== ヘッダー(タイトル + 日付 + 氏名) ===== */
  .header {
    margin-bottom: 6mm;
    /* タイトル直下で改ページしないように。本文ヘッダ単独で 1 ページ目を終えるのを防ぐ。 */
    page-break-after: avoid;
    break-after: avoid;
  }
  .header h1 {
    margin: 0;
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.4em;
  }
  .header-meta {
    margin-top: 4mm;
    display: flex;
    justify-content: flex-end;
    gap: 8mm;
    font-size: 12px;
  }
  .name-empty {
    /* 履歴書未選択時の氏名空欄に下線を引く(プレビューと同じ見た目) */
    display: inline-block;
    min-width: 80px;
    border-bottom: 1px solid #888;
  }
  .header-hint {
    margin-top: 1mm;
    text-align: right;
    font-size: 10px;
    color: #888;
  }

  /* ===== セクション見出し ===== */
  .section { margin-top: 6mm; }
  .section-heading {
    border-bottom: 1px solid #000;
    padding-bottom: 1mm;
    font-size: 14px;
    font-weight: 700;
    /* 見出しだけ前ページに残る「孤児」を防ぐ */
    page-break-after: avoid;
    break-after: avoid;
  }
  .section-heading .mark { margin-right: 6px; }

  /* ===== 本文(要約・自己PR の自由記述) ===== */
  .text-body {
    margin-top: 2mm;
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
  }
  .empty-hint {
    margin-top: 2mm;
    font-size: 11px;
    color: #999;
  }

  /* ===== 職務経歴ブロック ===== */
  .work-list { margin-top: 3mm; }
  .work-block {
    /* ブロックが途中で改ページされないように。1 ページに収まらない場合は次ページへ。 */
    page-break-inside: avoid;
    break-inside: avoid;
    border: 1px solid #555;
    padding: 3mm 4mm;
    margin-top: 3mm;
  }
  .work-block:first-child { margin-top: 0; }
  .work-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4mm;
    border-bottom: 1px solid #999;
    padding-bottom: 1.5mm;
  }
  .work-company { font-size: 13px; font-weight: 600; }
  .work-period { font-size: 11px; white-space: nowrap; }
  .work-meta {
    margin-top: 2mm;
    font-size: 11px;
  }
  .work-meta span { margin-right: 4mm; }
  .work-sub { margin-top: 3mm; }
  .work-sub-title { font-size: 11px; font-weight: 700; }
  .work-sub-body {
    margin-top: 1mm;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  /* ===== スキル ===== */
  .skill-groups { margin-top: 3mm; }
  .skill-group { margin-top: 3mm; }
  .skill-group:first-child { margin-top: 0; }
  .skill-group-title { font-size: 11px; font-weight: 700; }
  .skill-list {
    margin: 1mm 0 0 0;
    padding-left: 0;
    list-style: none;
  }
  .skill-item {
    font-size: 12px;
    line-height: 1.6;
  }
  .skill-item .mark { margin-right: 4px; }
  .skill-level {
    margin-left: 4px;
    font-size: 10px;
    color: #555;
  }
  .skill-desc {
    margin-left: 6px;
    font-size: 11px;
  }

  /* ===== 資格 ===== */
  .license-table {
    margin-top: 2mm;
    width: 100%;
    border-collapse: collapse;
  }
  .license-table tr {
    /* 1 件が途中で改ページされないように */
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .license-table td {
    border-bottom: 1px solid #999;
    padding: 1.5mm 0;
    vertical-align: top;
  }
  .license-date { width: 30mm; font-size: 11px; }
  .license-name { font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>職 務 経 歴 書</h1>
    <div class="header-meta">
      <div>${today} 現在</div>
      <div>
        氏名
        ${name ? escapeHtml(name) : `<span class="name-empty"></span>`}
      </div>
    </div>
    ${name ? "" : `<p class="header-hint">※ 履歴書を選択すると氏名が反映されます</p>`}
  </div>

  <section class="section">
    <h2 class="section-heading"><span class="mark">■</span>職務要約</h2>
    ${
      body.summary
        ? `<div class="text-body">${escapeHtml(body.summary)}</div>`
        : `<p class="empty-hint">(未入力)</p>`
    }
  </section>

  <section class="section">
    <h2 class="section-heading"><span class="mark">■</span>職務経歴</h2>
    <div class="work-list">
      ${workExperiencesHtml}
    </div>
  </section>

  <section class="section">
    <h2 class="section-heading"><span class="mark">■</span>活かせる経験・スキル</h2>
    <div class="skill-groups">
      ${skillsHtml}
    </div>
  </section>

  <section class="section">
    <h2 class="section-heading"><span class="mark">■</span>資格</h2>
    ${licensesHtml}
  </section>

  <section class="section">
    <h2 class="section-heading"><span class="mark">■</span>自己PR</h2>
    ${
      body.self_pr
        ? `<div class="text-body">${escapeHtml(body.self_pr)}</div>`
        : `<p class="empty-hint">(未入力)</p>`
    }
  </section>
</body>
</html>`;
}

// ====================================================================
// 部品レンダラ
// ====================================================================

function renderWorkExperience(we: WorkExperience): string {
  const periodText = formatPeriodRange(we.period_start, we.period_end);

  // メタ情報(業界・役職・雇用形態)は埋まっているものだけ並べる
  const metaParts: string[] = [];
  if (we.industry) metaParts.push(`業界:${escapeHtml(we.industry)}`);
  if (we.position) metaParts.push(`役職:${escapeHtml(we.position)}`);
  if (we.employment_type)
    metaParts.push(`雇用形態:${escapeHtml(employmentTypeLabels[we.employment_type])}`);

  const metaHtml = metaParts.length
    ? `<div class="work-meta">${metaParts.map((p) => `<span>${p}</span>`).join("")}</div>`
    : "";

  const jobDescHtml = we.job_description
    ? `<div class="work-sub">
        <div class="work-sub-title">業務内容</div>
        <div class="work-sub-body">${escapeHtml(we.job_description)}</div>
      </div>`
    : "";

  const achievementsHtml = we.achievements
    ? `<div class="work-sub">
        <div class="work-sub-title">実績・成果</div>
        <div class="work-sub-body">${escapeHtml(we.achievements)}</div>
      </div>`
    : "";

  return `<div class="work-block">
    <div class="work-header">
      <div class="work-company">${escapeHtml(we.company_name)}</div>
      <div class="work-period">${escapeHtml(periodText)}</div>
    </div>
    ${metaHtml}
    ${jobDescHtml}
    ${achievementsHtml}
  </div>`;
}

function renderSkills(skills: Skill[]): string {
  const grouped = groupSkillsByCategory(skills);
  const groups: string[] = [];

  for (const cat of skillCategories) {
    const list = grouped.get(cat);
    if (!list || list.length === 0) continue;

    const items = list
      .map((s) => {
        const level = s.level
          ? `<span class="skill-level">(${escapeHtml(skillLevelLabels[s.level])})</span>`
          : "";
        const desc = s.description
          ? `<span class="skill-desc">— ${escapeHtml(s.description)}</span>`
          : "";
        return `<li class="skill-item"><span class="mark">・</span>${escapeHtml(s.name)}${level}${desc}</li>`;
      })
      .join("");

    groups.push(`<div class="skill-group">
      <div class="skill-group-title">【${escapeHtml(skillCategoryLabels[cat])}】</div>
      <ul class="skill-list">${items}</ul>
    </div>`);
  }

  return groups.join("\n");
}

function renderLicenses(licenses: LicenseItem[]): string {
  const rows = licenses
    .map(
      (l) => `<tr>
        <td class="license-date">${escapeHtml(formatYearMonth(l.year, l.month))}</td>
        <td class="license-name">${escapeHtml(l.name)}</td>
      </tr>`,
    )
    .join("\n");
  return `<table class="license-table"><tbody>${rows}</tbody></table>`;
}

// ====================================================================
// ヘルパー
// ====================================================================

function formatPeriodPoint(p: PeriodPoint | null): string {
  if (!p) return "";
  return `${p.year}年${p.month}月`;
}

function formatPeriodRange(start: PeriodPoint | null, end: PeriodPoint | null): string {
  const startText = formatPeriodPoint(start);
  const endText = end ? formatPeriodPoint(end) : start ? "現在" : "";

  if (!startText && !endText) return "(期間未入力)";
  if (!startText) return `〜 ${endText}`;
  return `${startText} 〜 ${endText}`;
}

function formatYearMonth(year: number | null, month: number | null): string {
  if (year == null || month == null) return "";
  return `${year}年${month}月`;
}

function groupSkillsByCategory(skills: Skill[]): Map<SkillCategory, Skill[]> {
  const map = new Map<SkillCategory, Skill[]>();
  for (const s of skills) {
    const list = map.get(s.category) ?? [];
    list.push(s);
    map.set(s.category, list);
  }
  return map;
}

function formatDocumentDate(documentDate: string | null): string {
  const d = documentDate ? new Date(documentDate) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safe.getFullYear()} 年 ${safe.getMonth() + 1} 月 ${safe.getDate()} 日`;
}

// escapeHtml は lib/html/escape.ts に集約(本ファイル冒頭で import)。
// 履歴書(resume-html.ts)と同じ責務を共有することで、片方だけバグ修正が当たる
// 事故を防ぐ。会社名・業務内容・自己PR を埋め込む前に必ず通す責務は同じ。
