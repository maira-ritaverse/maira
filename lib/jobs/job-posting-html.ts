/**
 * 求人票 PDF 用 HTML テンプレート
 *
 * エージェントが 受け取った 求人票 サンプル(表形式 / 2 列 ヘッダー /
 * 仕事内容 / 給与詳細 / 福利厚生 / 会社概要 の セクション分け)を 模倣 した
 * 求人票 を 出力する。
 *
 * 設計:
 *   ・我々の DB は 18 カラム + description (★ 区切り 集約) の フラット スキーマ。
 *     サンプル の 「採用企業名 / 求人名 / 求人ID / 仕事内容 / 募集背景 / 配属先 /
 *     PR ポイント / 給与詳細 / 諸手当 / 福利厚生詳細 / 会社概要 ...」を
 *     description の ★ セクションから 取り出して 各セルに 割り当てる。
 *   ・無い 項目は 空欄(空セル)で 出す。「項目自体を 消す」のでは なく、
 *     サンプルの 体裁を 保つ ために 行は そのまま 残す。
 *   ・PDF 化は @/lib/pdf/generate の Puppeteer 基盤を そのまま 使う。
 *
 * セキュリティ:
 *   ・全テキスト は escapeHtml で </body> や script 注入を 防ぐ。
 */
import { escapeHtml } from "@/lib/html/escape";
import { parseJobDescription, sortJobDescriptionSections } from "@/lib/jobs/parse-description";
import type { JobPosting } from "@/lib/jobs/types";

type Options = {
  job: JobPosting;
  /** PDF 上に 出す 「採用企業名」上の 小見出し(発行元の エージェンシー名)。任意。 */
  agencyName?: string;
};

export function buildJobPostingHtml({ job, agencyName }: Options): string {
  const sections = sortJobDescriptionSections(parseJobDescription(job.description));
  const sec = (title: string): string => sections.find((s) => s.title === title)?.body ?? "";

  // 各セルに 入れる 値を 用意。空欄は "" で 通す(行を 残す 設計)。
  const salaryRange = formatSalary(job.salaryMin, job.salaryMax);
  const features = sec("特徴");
  const work = sec("仕事内容");
  const background = sec("募集背景");
  const team = sec("配属先");
  const points = sec("ポイント");
  const salaryDetail = sec("給与備考");
  const benefits = sec("福利厚生");
  const companyInfo = sec("会社情報");
  const jobIdHint = sec("求人ID");

  // 仕事内容セクション に 配属先 / ポイント が ある場合は 結合して 1 セルに 表示。
  // サンプル PDF も 「仕事内容」セルに 業務 + 配属先 + ポイント を 詰めているため。
  const workCombined = [
    work,
    team && `【配属先】\n${team}`,
    points && `【仕事のポイント】\n${points}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${job.companyName} / ${job.position} 求人票`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: #111;
    background: #fff;
    font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif;
    font-size: 11px;
    line-height: 1.55;
  }
  h1 { font-size: 18px; text-align: center; margin: 0 0 12px; letter-spacing: 0.25em; }
  h2 { font-size: 13px; text-align: center; margin: 18px 0 8px; letter-spacing: 0.2em; }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-bottom: 0;
    page-break-inside: auto;
  }
  table + table { margin-top: 4px; }
  tr { page-break-inside: avoid; }
  th, td {
    border: 1px solid #888;
    padding: 6px 8px;
    vertical-align: top;
    word-break: break-all;
    overflow-wrap: anywhere;
  }
  th {
    background: #f4f4f4;
    font-weight: 500;
    text-align: left;
    width: 18%;
  }
  td.section-head {
    background: #f4f4f4;
    font-weight: 500;
    padding: 4px 8px;
    border-top: 1px solid #888;
  }
  td.section-body {
    padding: 8px 10px;
    border-top: none;
    white-space: pre-wrap;
  }
  /* 2 列ペア(雇用形態 + 応募区分 など)用 */
  th.col-w {
    width: 14%;
  }
  td.col-v {
    width: 36%;
  }
  /* 「特徴」タグ風 表示 */
  .features {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .footnote {
    margin-top: 12px;
    font-size: 9px;
    color: #666;
  }
  .empty { color: #aaa; }
</style>
</head>
<body>

<h1>求人票</h1>

${agencyName ? `<p style="text-align:right;font-size:10px;margin:0 0 6px;color:#666;">発行: ${escapeHtml(agencyName)}</p>` : ""}

<!-- 求人基本情報 -->
<table>
  <colgroup>
    <col style="width:18%"><col style="width:32%">
    <col style="width:18%"><col style="width:32%">
  </colgroup>
  <tr>
    <th>採用企業名</th>
    <td colspan="3">${escapeHtml(job.companyName)}</td>
  </tr>
  <tr>
    <th>求人名</th>
    <td colspan="3">${escapeHtml(job.position)}</td>
  </tr>
  ${jobIdHint ? `<tr><th>求人ID</th><td colspan="3">${escapeHtml(jobIdHint.replace(/^求人ID[::]\s*/i, ""))}</td></tr>` : ""}
  <tr>
    <th>雇用形態</th>
    <td class="col-v">${escapeHtmlOrEmpty(job.employmentType)}</td>
    <th class="col-w">応募区分</th>
    <td class="col-v">中途</td>
  </tr>
  ${features ? `<tr><th>特徴</th><td colspan="3" class="features">${escapeHtml(features)}</td></tr>` : ""}
</table>

<!-- 仕事内容 -->
${sectionBlock("仕事内容", workCombined)}
${sectionBlock("仕事内容(変更の範囲)", job.workChangeScope)}
${sectionBlock("募集背景", background)}

<!-- 応募条件 / 歓迎条件 -->
${sectionBlock("応募条件", joinIfBoth(job.applicationQualifications, job.requiredSkills))}
${sectionBlock("歓迎条件", job.preferredSkills)}

<!-- 年収 / 給与詳細 -->
<table>
  <colgroup>
    <col style="width:18%"><col style="width:32%">
    <col style="width:18%"><col style="width:32%">
  </colgroup>
  <tr>
    <th>年収</th>
    <td colspan="3">${escapeHtml(salaryRange)}</td>
  </tr>
  ${salaryDetail ? `<tr><td class="section-head" colspan="4">給与詳細</td></tr><tr><td class="section-body" colspan="4">${escapeHtml(salaryDetail)}</td></tr>` : ""}
  <tr>
    <th>転勤の可能性</th>
    <td class="col-v">${escapeHtmlOrEmpty(extractTransferPossibility(job.locationChangeScope))}</td>
    <th class="col-w">勤務地</th>
    <td class="col-v">${escapeHtmlOrEmpty(job.location)}</td>
  </tr>
</table>

${sectionBlock("勤務地(変更の範囲)", job.locationChangeScope)}
${sectionBlock("勤務時間", joinIfBoth(job.workHours, job.breakTime ? `休憩 ${job.breakTime}` : null))}
${sectionBlock("福利厚生詳細", benefits)}
${sectionBlock("休日休暇", job.holidays)}

<table>
  <colgroup>
    <col style="width:18%"><col style="width:82%">
  </colgroup>
  <tr>
    <th>試用期間</th>
    <td>${escapeHtmlOrEmpty(job.probationPeriod)}</td>
  </tr>
  <tr>
    <th>受動喫煙対策</th>
    <td>${escapeHtmlOrEmpty(job.smokingPreventionMeasure)}</td>
  </tr>
</table>

<!-- 会社概要 -->
${companyInfo ? `<h2>会社概要</h2>${sectionBlock("採用企業 概要", companyInfo, /* skipHeader */ true)}` : ""}

<p class="footnote">
  ※ 本求人票に 記載の 労働条件 等が 労働契約締結時の 労働条件と 異なる 場合が ありますので ご注意ください。<br>
  ※ 本求人票には 一般公開されていない 情報も 含まれる ため、第三者への 提供・転送を 禁止します。
</p>

</body>
</html>`;
}

function sectionBlock(title: string, content: string | null, skipHeader = false): string {
  if (!content || content.trim() === "") {
    // 空欄でも 行を 残す(サンプル の 体裁を 保つ)。空セル を 1 行で 出す。
    return `<table><tr><td class="section-head">${escapeHtml(title)}</td></tr><tr><td class="section-body"><span class="empty">—</span></td></tr></table>`;
  }
  return `<table>${skipHeader ? "" : `<tr><td class="section-head">${escapeHtml(title)}</td></tr>`}<tr><td class="section-body">${escapeHtml(content)}</td></tr></table>`;
}

function escapeHtmlOrEmpty(v: string | null | undefined): string {
  if (!v || v.trim() === "") return `<span class="empty">—</span>`;
  return escapeHtml(v);
}

function formatSalary(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${min} 万円〜 ${max} 万円`;
  if (min !== null) return `${min} 万円〜`;
  if (max !== null) return `〜 ${max} 万円`;
  return "応相談";
}

function joinIfBoth(a: string | null, b: string | null): string | null {
  const aT = a?.trim();
  const bT = b?.trim();
  if (aT && bT) return `${aT}\n\n${bT}`;
  return aT || bT || null;
}

/**
 * location_change_scope の 「転勤なし(当面なし)」「転勤あり」のような
 * 短い 表現を 取り出して、転勤の可能性 セルに 表示する。
 * 文字列を そのまま 出すと 場所変更範囲の 説明が ダブるので 簡略化。
 */
function extractTransferPossibility(scope: string | null): string | null {
  if (!scope) return null;
  const s = scope.trim();
  if (/転勤なし|当面なし|なし/.test(s)) return "なし(当面なし)";
  if (/転勤あり|あり/.test(s)) return "あり";
  return null;
}
