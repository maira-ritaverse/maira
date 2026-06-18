import { escapeHtml } from "@/lib/html/escape";

import type { AgencyClientCv } from "./types";

/**
 * エージェント所有の職務経歴書を A4 縦の HTML として組み立てる。
 *
 * seeker 側 lib/cvs/cv-html.ts(buildCvHtml)は work_experiences / skills の
 * 構造化テンプレートを前提とするが、エージェント側 AgencyClientCv.body は
 * { summary, body } の自由記述。したがって本ファイルでは自由記述を素直に
 * 段落 / 改行を尊重して表示する シンプルな PDF テンプレを実装する。
 *
 * 設計判断:
 *   ・日本語フォントは Noto Serif JP を Web フォントで読込(豆腐対策)
 *   ・全テキストは escapeHtml して XSS / </body> 注入を防ぐ
 *   ・@page の自動改ページに任せる(自由記述は長さ可変)
 */
type Options = {
  cv: AgencyClientCv;
  clientName: string;
};

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

export function buildAgencyCvHtml({ cv, clientName }: Options): string {
  const today = formatDocumentDate(cv.documentDate);
  const safeTitle = escapeHtml(cv.title);
  const safeClientName = escapeHtml(clientName);
  const safeSummary = escapeHtml(cv.body.summary);
  const safeBody = escapeHtml(cv.body.body);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: #000;
    background: #fff;
    font-family: "Noto Serif JP", "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif;
    font-size: 12px;
    line-height: 1.65;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: ${PAGE_WIDTH_MM - 30}mm; /* 余白 15mm × 2 を引いた可視域 */
    min-height: ${PAGE_HEIGHT_MM - 30}mm;
  }
  h1.title {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 4px 0;
    letter-spacing: 0.05em;
    text-align: center;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    margin: 0 0 18px 0;
    color: #444;
    font-size: 12px;
  }
  h2.section {
    font-size: 14px;
    font-weight: 700;
    margin: 16px 0 6px 0;
    padding: 4px 8px;
    border-left: 3px solid #000;
    background: #f4f4f4;
    page-break-after: avoid;
    break-after: avoid;
  }
  p, .body-text {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0 0 12px 0;
  }
</style>
</head>
<body>
  <div class="sheet">
    <h1 class="title">職務経歴書</h1>
    <div class="meta">
      <span>${safeClientName}</span>
      <span>${escapeHtml(today)} 現在</span>
    </div>

    <h2 class="section">要約</h2>
    <p class="body-text">${safeSummary || "(未入力)"}</p>

    <h2 class="section">職務経歴・本文</h2>
    <p class="body-text">${safeBody || "(未入力)"}</p>
  </div>
</body>
</html>`;
}

function formatDocumentDate(documentDate: string | null): string {
  if (documentDate) {
    const d = new Date(documentDate);
    if (!Number.isNaN(d.getTime())) return formatYmd(d);
  }
  return formatYmd(new Date());
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
