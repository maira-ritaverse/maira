import { genderLabels, type EducationItem, type LicenseItem, type Resume } from "./types";

/**
 * 履歴書(厚労省様式)のスタンドアロン HTML 文字列ビルダー
 *
 * Phase 2-A の resume-preview.tsx と同じレイアウトを、Puppeteer に渡せる
 * 「完全な HTML 文字列」として生成する。React レンダリングではなく
 * テンプレートリテラルで組み立てる(Puppeteer の page.setContent に渡すため)。
 *
 * 設計方針:
 * - レイアウト寸法 / 行数 / 罫線スタイルは resume-preview.tsx と一致させる
 *   (見た目の二重管理になるが、Phase 2-A 終了直後の段階では同期は容易。
 *    将来的に「DOM 表示版」と「PDF 用 HTML 版」を共通化するのが望ましい)
 * - 日本語フォントは Google Fonts の Noto Sans JP / Noto Serif JP を埋め込む
 *   → 本番(@sparticuz/chromium)は日本語フォントを内包しないため、Web フォント
 *     を埋め込まないと豆腐(□□□)になる。明朝系の伝統的な見た目に合わせて
 *     Noto Serif JP を body のフォントに採用する。
 * - 文字列を埋め込むときは必ず escapeHtml を通す(XSS / 不正な </body> 等の防止)
 */

// A4 縦の物理寸法(mm)。CSS の mm はそのまま物理 mm を表す。
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// 学歴・職歴/免許・資格の各表に確保する行数(プレビューと一致)
const ROWS_HISTORY_PAGE_1 = 15;
const ROWS_HISTORY_PAGE_2 = 8;
const ROWS_LICENSE = 8;

export function buildResumeHtml(resume: Resume): string {
  const age = calcAge(resume.birthDate);
  const genderLabel = resume.gender ? genderLabels[resume.gender] : "";
  const birthDateText = formatBirthDate(resume.birthDate, age);
  const today = formatDocumentDate(resume.documentDate);

  const allHistory = resume.educationHistory;
  const historyPage1 = padRows(allHistory.slice(0, ROWS_HISTORY_PAGE_1), ROWS_HISTORY_PAGE_1);
  const historyPage2 = padRows(
    allHistory.slice(ROWS_HISTORY_PAGE_1, ROWS_HISTORY_PAGE_1 + ROWS_HISTORY_PAGE_2),
    ROWS_HISTORY_PAGE_2,
  );
  const licenseRows = padRows(resume.licenses, ROWS_LICENSE);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>履歴書</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  /* ===== ページ設定 ===== */
  @page {
    size: A4;
    margin: 0;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    color: #000;
    background: #fff;
    /* 履歴書らしい明朝系。Web フォントが読めなかった場合のフォールバックも併記。 */
    font-family: "Noto Serif JP", "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif;
    /* ブラウザの拡大縮小に依存しないよう絶対値で固定 */
    font-size: 12px;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ===== ページ(A4 縦シート) ===== */
  .page {
    width: ${PAGE_WIDTH_MM}mm;
    min-height: ${PAGE_HEIGHT_MM}mm;
    padding: 10mm;
    /* 印刷時に次ページへ送る(2 ページ目に学歴続き等が来る) */
    page-break-after: always;
    break-after: page;
  }
  .page:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  /* ===== 罫線セル共通 ===== */
  .box {
    border: 1px solid #000;
  }
  .row {
    display: flex;
  }
  .border-r { border-right: 1px solid #000; }
  .border-b { border-bottom: 1px solid #000; }
  .border-l { border-left: 1px solid #000; }
  .border-x { border-left: 1px solid #000; border-right: 1px solid #000; }

  /* ===== ヘッダー(履歴書タイトル + 日付) ===== */
  .header-title {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    border-bottom: 1px solid #000;
    padding: 8px 12px;
  }
  .header-title h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.3em;
  }
  .header-title .today {
    font-size: 11px;
  }

  /* ===== 基本情報ブロック(左カラム = 氏名・生年月日、右カラム = 写真) ===== */
  .basic-block {
    display: flex;
    border: 1px solid #000;
  }
  .basic-left {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .basic-right {
    display: flex;
    width: 120px;
    flex-shrink: 0;
    border-left: 1px solid #000;
    align-items: stretch;
    justify-content: center;
  }

  /* ふりがな行 / 氏名行 / 生年月日行 */
  .row-furigana {
    display: flex;
    border-bottom: 1px solid #000;
  }
  .label-cell-narrow {
    flex-shrink: 0;
    width: 60px;
    border-right: 1px solid #000;
    padding: 2px 8px;
    font-size: 9px;
  }
  .label-cell {
    flex-shrink: 0;
    width: 60px;
    border-right: 1px solid #000;
    background: #fff;
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .furigana-value {
    flex: 1;
    padding: 2px 12px;
    font-size: 10px;
  }
  .name-row {
    display: flex;
    flex: 1;
    border-bottom: 1px solid #000;
  }
  .name-value {
    flex: 1;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 18px;
  }
  .birth-row {
    display: flex;
  }
  .birth-cell {
    flex: 1;
    border-right: 1px solid #000;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    font-size: 12px;
  }
  .gender-label {
    width: 100px;
    border-right: 1px solid #000;
    padding: 8px;
    text-align: center;
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gender-value {
    width: 80px;
    padding: 8px;
    text-align: center;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 写真欄 */
  .photo-box {
    flex: 1;
    padding: 8px;
    font-size: 9px;
    line-height: 1.2;
    display: flex;
    flex-direction: column;
  }
  .photo-box p { margin: 0 0 2px 0; }
  .photo-box .gap-2 { margin-top: 8px; }
  /* 「横 24〜30mm」は「1. 縦 36〜40mm」の続きとして数字位置を揃えるためのインデント */
  .photo-box .photo-indent { padding-left: 12px; }
  .photo-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ===== 住所ブロック ===== */
  .address-block {
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    border-bottom: 1px solid #000;
  }
  .address-row {
    display: flex;
  }
  .address-body {
    flex: 1;
    padding: 8px 12px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .address-body .postal {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .address-body .addr-line {
    margin-top: 4px;
    min-height: 1.2em;
  }
  .address-body .note {
    margin-top: 4px;
    font-size: 9px;
    color: #555;
  }
  .address-body .mail {
    margin-top: 4px;
    font-size: 11px;
  }
  .phone-block {
    width: 140px;
    flex-shrink: 0;
    border-left: 1px solid #000;
    display: flex;
    flex-direction: column;
  }
  .phone-label {
    border-bottom: 1px solid #000;
    padding: 4px 8px;
    font-size: 10px;
  }
  .phone-value {
    flex: 1;
    padding: 0 8px;
    display: flex;
    align-items: center;
    font-size: 12px;
  }

  /* ===== 表(学歴・職歴 / 免許・資格) ===== */
  table.history-table, table.license-table {
    width: 100%;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    border-bottom: 1px solid #000;
    border-collapse: collapse;
  }
  table.history-table th, table.license-table th {
    border: 1px solid #000;
    padding: 4px 8px;
    text-align: center;
    font-size: 11px;
    font-weight: 500;
  }
  table.history-table td, table.license-table td {
    border: 1px solid #000;
    padding: 0 8px;
    height: 8mm;
    font-size: 12px;
    vertical-align: middle;
  }
  table.history-table td.cell-ym, table.license-table td.cell-ym {
    text-align: center;
    font-size: 11px;
  }
  th.col-year { width: 48px; }
  th.col-month { width: 40px; }

  /* ===== 志望動機 / 本人希望記入欄 ===== */
  .motiv-box, .req-box {
    margin-top: 12px;
    border: 1px solid #000;
  }
  .motiv-box .head, .req-box .head {
    border-bottom: 1px solid #000;
    background: #fff;
    padding: 4px 8px;
    font-size: 11px;
  }
  .motiv-box .body {
    min-height: 60mm;
    padding: 8px 12px;
    font-size: 12px;
    white-space: pre-wrap;
  }
  .req-box .body {
    min-height: 30mm;
    padding: 8px 12px;
    font-size: 12px;
    white-space: pre-wrap;
  }

  /* ===== 注記 ===== */
  .footnote {
    margin-top: 8px;
    font-size: 9px;
    color: #444;
  }
</style>
</head>
<body>
  <!-- ===== 1 ページ目 ===== -->
  <div class="page">
    <!-- 基本情報 + 写真 -->
    <div class="basic-block">
      <div class="basic-left">
        <div class="header-title">
          <h2>履 歴 書</h2>
          <p class="today">${escapeHtml(today)} 現在</p>
        </div>
        <div class="row-furigana">
          <div class="label-cell-narrow">ふりがな</div>
          <div class="furigana-value">${escapeHtml(resume.nameKana ?? "")}</div>
        </div>
        <div class="name-row">
          <div class="label-cell">氏 名</div>
          <div class="name-value">${escapeHtml(resume.name ?? "")}</div>
        </div>
        <div class="birth-row">
          <div class="birth-cell">${escapeHtml(birthDateText)}</div>
          <div class="gender-label">※性別</div>
          <div class="gender-value">${escapeHtml(genderLabel)}</div>
        </div>
      </div>
      <div class="basic-right">
        ${renderPhotoBox(resume.photoUrl)}
      </div>
    </div>

    <!-- 現住所 -->
    ${renderAddressBlock({
      addressKana: resume.addressKana,
      postalCode: resume.postalCode,
      address: resume.address,
      phone: resume.phone,
      email: resume.email,
      label: "現住所",
    })}

    <!-- 連絡先 -->
    ${renderAddressBlock({
      addressKana: resume.contactAddressKana,
      postalCode: null,
      address: resume.contactAddress,
      phone: resume.contactPhone,
      email: null,
      label: "連絡先",
      note: "(現住所以外に連絡を希望する場合のみ記入)",
    })}

    <!-- 学歴・職歴(1 ページ目) -->
    ${renderHistoryTable(historyPage1, true)}

    <p class="footnote">※「性別」欄:記載は任意です。未記載とすることも可能です。</p>
  </div>

  <!-- ===== 2 ページ目 ===== -->
  <div class="page">
    <!-- 学歴・職歴の続き -->
    ${renderHistoryTable(historyPage2, true)}

    <!-- 免許・資格 -->
    ${renderLicenseTable(licenseRows)}

    <!-- 志望の動機 -->
    <div class="motiv-box">
      <div class="head">志望の動機、特技、好きな学科、アピールポイントなど</div>
      <div class="body">${escapeHtml(resume.motivationNote ?? "")}</div>
    </div>

    <!-- 本人希望記入欄 -->
    <div class="req-box">
      <div class="head">本人希望記入欄(特に給料・職種・勤務時間・勤務地・その他についての希望などがあれば記入)</div>
      <div class="body">${escapeHtml(resume.personalRequests ?? "")}</div>
    </div>
  </div>
</body>
</html>`;
}

// ====================================================================
// パーツビルダー
// ====================================================================

function renderPhotoBox(photoUrl: string | null): string {
  if (photoUrl) {
    // 注:photoUrl が外部 URL の場合、Puppeteer の networkidle0 待ちで取得される。
    // 値はユーザー由来なので必ずエスケープ。
    return `<div class="photo-box"><img src="${escapeHtml(photoUrl)}" alt="本人写真" class="photo-img"></div>`;
  }
  // 厚労省様式の規定寸法。原本注記をそのまま再現することで本人の貼り間違いを防ぐ。
  return `<div class="photo-box">
    <p>写真をはる位置</p>
    <p class="gap-2">写真をはる必要が</p>
    <p>ある場合</p>
    <p class="gap-2">1. 縦 36〜40mm</p>
    <p class="photo-indent">横 24〜30mm</p>
    <p>2. 本人単身胸から上</p>
    <p>3. 裏面のりづけ</p>
  </div>`;
}

function renderAddressBlock(args: {
  addressKana: string | null | undefined;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  label: string;
  note?: string;
}): string {
  const { addressKana, postalCode, address, phone, email, label, note } = args;
  return `<div class="address-block">
    <div class="row-furigana">
      <div class="label-cell-narrow">ふりがな</div>
      <div class="furigana-value">${escapeHtml(addressKana ?? "")}</div>
    </div>
    <div class="address-row">
      <div class="label-cell">${escapeHtml(label)}</div>
      <div class="address-body">
        <div class="postal"><span>〒</span><span>${escapeHtml(postalCode ?? "")}</span></div>
        <div class="addr-line">${escapeHtml(address ?? "")}</div>
        ${note ? `<div class="note">${escapeHtml(note)}</div>` : ""}
        ${email ? `<div class="mail">メール ${escapeHtml(email)}</div>` : ""}
      </div>
      <div class="phone-block">
        <div class="phone-label">電話</div>
        <div class="phone-value">${escapeHtml(phone ?? "")}</div>
      </div>
    </div>
  </div>`;
}

function renderHistoryTable(rows: (EducationItem | null)[], showHeader: boolean): string {
  const head = showHeader
    ? `<thead><tr>
        <th class="col-year">年</th>
        <th class="col-month">月</th>
        <th>学 歴・職 歴(各別にまとめて書く)</th>
      </tr></thead>`
    : "";
  const body = rows
    .map(
      (row) => `<tr>
        <td class="cell-ym">${row?.year ?? ""}</td>
        <td class="cell-ym">${row?.month ?? ""}</td>
        <td>${escapeHtml(row?.description ?? "")}</td>
      </tr>`,
    )
    .join("");
  return `<table class="history-table">${head}<tbody>${body}</tbody></table>`;
}

function renderLicenseTable(rows: (LicenseItem | null)[]): string {
  const body = rows
    .map(
      (row) => `<tr>
        <td class="cell-ym">${row?.year ?? ""}</td>
        <td class="cell-ym">${row?.month ?? ""}</td>
        <td>${escapeHtml(row?.name ?? "")}</td>
      </tr>`,
    )
    .join("");
  return `<table class="license-table">
    <thead><tr>
      <th class="col-year">年</th>
      <th class="col-month">月</th>
      <th>免 許・資 格</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// ====================================================================
// ヘルパー
// ====================================================================

function padRows<T>(items: T[], min: number): (T | null)[] {
  if (items.length >= min) return items;
  return [...items, ...Array<null>(min - items.length).fill(null)];
}

/**
 * 西暦の生年月日 → 「YYYY年M月D日生 (満○歳)」表記。
 * 未入力時はプレビューと同じく空欄記号で枠を保つ。
 */
function formatBirthDate(birthDate: string | null, age: number | null): string {
  if (!birthDate) return "　　年　　月　　日生 (満　　歳)";
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return "";
  const ageText = age !== null ? `(満 ${age} 歳)` : "";
  return `${d.getFullYear()}年 ${d.getMonth() + 1}月 ${d.getDate()}日生 ${ageText}`;
}

/**
 * 満年齢計算。誕生日未到来は -1。
 */
function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/**
 * 履歴書「○年○月○日 現在」の日付を西暦で返す。
 *
 * documentDate(YYYY-MM-DD)が指定されていればそれを採用し、
 * 未指定なら本日の日付にフォールバックする。
 * 生年月日・学歴・職歴も西暦表記なので、現在日付も西暦に揃える。
 */
function formatDocumentDate(documentDate: string | null): string {
  const d = documentDate ? new Date(documentDate) : new Date();
  // パース不能(壊れた値を渡された場合)は本日にフォールバック
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safe.getFullYear()} 年 ${safe.getMonth() + 1} 月 ${safe.getDate()} 日`;
}

/**
 * HTML エスケープ。
 *
 * resume の文字列項目(氏名・住所・志望動機等)はユーザー入力なので、
 * テンプレートリテラルで埋め込む前に必ず通す。
 * これを忘れると </body> や <script> を仕込まれて PDF 出力が壊れる/
 * 任意スクリプト実行(Puppeteer 内)につながる。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
