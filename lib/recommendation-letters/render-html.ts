import { escapeHtml } from "@/lib/html/escape";

import type { RecommendationLetter, RecommendationLetterTemplate } from "./types";

/**
 * 推薦文(求人企業提出用)のスタンドアロン HTML 文字列ビルダー
 *
 * 用途:
 *   ・PDF 生成(Puppeteer の page.setContent に渡す)
 *   ・編集画面のリアルタイムプレビュー(同じ HTML を <iframe srcDoc> や DOM 直挿入)
 *
 * 設計:
 *   ・A4 縦、上下左右 20mm、明朝系の伝統的レイアウト
 *   ・テンプレ(prefix_body / suffix_body)は本文と「同レイアウトで連結表示」する。
 *     AI 生成では本文だけを作り、組織共通の挨拶 / 連絡先を末尾に統一する設計。
 *   ・XSS 対策:本文・件名・宛名・組織名はすべて escapeHtml を通す。
 *     本文の改行は `white-space: pre-wrap` で保持(<br> 注入は避け、エスケープと両立)。
 */

export type BuildRecommendationLetterHtmlInput = {
  letter: Pick<RecommendationLetter, "headline" | "body" | "version" | "status">;
  /** 適用テンプレ。null なら prefix/suffix は表示しない。 */
  template: Pick<RecommendationLetterTemplate, "prefixBody" | "suffixBody"> | null;
  /** 推薦元(エージェント)組織名。フッタ・ヘッダに表示。 */
  organizationName: string;
  /** 推薦先(求人企業)の会社名。宛名に使う。 */
  recipientCompanyName: string;
  /** 推薦対象の求人ポジション(件名補助、本文では使わない) */
  recipientPosition: string;
  /**
   * 発行日(YYYY-MM-DD 形式)。
   * モデル決定論性のためテンプレートリテラルから new Date() を切り離し、
   * 呼び出し側で渡す方針(本ファイル内に副作用 / 時刻依存を持たせない)。
   */
  documentDate: string;
};

/**
 * 日付 YYYY-MM-DD を日本語表記「2026年6月17日」に整形する。
 * 不正値はそのまま返してフェイルオープン(プレビュー UI が崩れないように)。
 */
function formatJpDate(yyyyMmDd: string): string {
  const m = yyyyMmDd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return yyyyMmDd;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return `${y}年${mo}月${d}日`;
}

export function buildRecommendationLetterHtml(input: BuildRecommendationLetterHtmlInput): string {
  const { letter, template, organizationName, recipientCompanyName, documentDate } = input;

  const safeHeadline = escapeHtml(letter.headline || "(件名未設定)");
  const safeBody = escapeHtml(letter.body || "");
  const safePrefix = template ? escapeHtml(template.prefixBody) : "";
  const safeSuffix = template ? escapeHtml(template.suffixBody) : "";
  const safeOrganization = escapeHtml(organizationName);
  const safeRecipient = escapeHtml(recipientCompanyName);
  const safeDate = escapeHtml(formatJpDate(documentDate));

  // ステータス(下書き / 確定済)とバージョン番号は提出書類には不要なので
  // プレビュー / PDF には出さない。エディタ画面の sticky ヘッダ側にのみ表示する。

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>推薦文</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page {
    size: A4;
    margin: 0;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: #111;
    background: #fff;
    /* 推薦状は伝統的に明朝系。フォールバックも明朝で揃える。 */
    font-family: "Noto Serif JP", "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif;
    font-size: 11pt;
    line-height: 1.8;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 20mm;
  }
  /* === ヘッダ:発行日 + 推薦元組織名 === */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16mm;
    font-size: 10pt;
    color: #333;
  }
  .header .date { white-space: nowrap; }
  .header .organization { text-align: right; font-weight: 500; }
  /* === 宛名 === */
  .recipient {
    font-size: 13pt;
    margin-bottom: 10mm;
  }
  /* === 件名(センター揃え、罫線で目立たせる) === */
  .headline {
    text-align: center;
    font-size: 14pt;
    font-weight: 700;
    margin: 6mm 0 12mm;
    padding-bottom: 3mm;
    border-bottom: 1px solid #111;
    letter-spacing: 0.1em;
  }
  /* === 本文(prefix → body → suffix を縦に並べる) ===
     pre-wrap で改行を保持しつつ XSS は escapeHtml で防ぐ。 */
  .body-section {
    margin-bottom: 8mm;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* テンプレ部分は本文と同じ字体だが、若干色を落として「定型句感」を出す。
     とはいえ印刷物として違和感が出ない範囲に。 */
  .body-section.template { color: #222; }
  /* === フッタ:組織名(末尾署名相当) === */
  .footer {
    margin-top: 20mm;
    text-align: right;
    font-size: 10pt;
    color: #333;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="date">${safeDate}</div>
    <div class="organization">${safeOrganization}</div>
  </div>

  <div class="recipient">${safeRecipient} 採用ご担当者様</div>

  <div class="headline">${safeHeadline}</div>

  ${safePrefix ? `<div class="body-section template">${safePrefix}</div>` : ""}
  <div class="body-section">${safeBody}</div>
  ${safeSuffix ? `<div class="body-section template">${safeSuffix}</div>` : ""}

  <div class="footer">${safeOrganization}</div>
</div>
</body>
</html>`;
}

/**
 * 「コピー用テキスト」を生成する。
 *
 * prefix → 本文 → suffix を空行で連結したプレーンテキスト。
 * メールやチャットに貼り付けて使う用途。
 */
export function buildRecommendationLetterPlainText(input: {
  letter: Pick<RecommendationLetter, "headline" | "body">;
  template: Pick<RecommendationLetterTemplate, "prefixBody" | "suffixBody"> | null;
  recipientCompanyName: string;
  organizationName: string;
  documentDate: string;
}): string {
  const parts: string[] = [];
  parts.push(formatJpDate(input.documentDate));
  parts.push(input.organizationName);
  parts.push("");
  parts.push(`${input.recipientCompanyName} 採用ご担当者様`);
  parts.push("");
  if (input.letter.headline.trim().length > 0) {
    parts.push(`件名:${input.letter.headline.trim()}`);
    parts.push("");
  }
  if (input.template?.prefixBody) {
    parts.push(input.template.prefixBody);
    parts.push("");
  }
  parts.push(input.letter.body || "");
  if (input.template?.suffixBody) {
    parts.push("");
    parts.push(input.template.suffixBody);
  }
  parts.push("");
  parts.push(input.organizationName);
  return parts.join("\n");
}

/**
 * 推薦文のファイル名生成(PDF ダウンロード用)。
 *
 * 「推薦文_{candidate}_{company}_v{n}.pdf」形式。
 * 候補者名と企業名を含むが、英数以外は _ で安全化する(Content-Disposition 用)。
 *
 * 候補者名は client.name(暗号化対象ではない、エージェント管理名)。
 * 暗号化対象の本文を含めないのは「ファイル名は OS / メーラのキャッシュに残るため」。
 */
export function buildRecommendationLetterFilename(input: {
  candidateName: string;
  companyName: string;
  version: number;
}): string {
  const sanitize = (s: string) => s.replace(/[^\p{L}\p{N}\-_]/gu, "_").slice(0, 40);
  const candidate = sanitize(input.candidateName) || "candidate";
  const company = sanitize(input.companyName) || "company";
  return `推薦文_${candidate}_${company}_v${input.version}.pdf`;
}
