import { escapeHtml } from "@/lib/html/escape";
import {
  NDA_DISCLOSER_ADDRESS,
  NDA_DISCLOSER_NAME,
  NDA_HAS_DISCLOSER_ADDRESS,
} from "@/lib/nda/nda-content";

import { TERMS_LAST_UPDATED, TERMS_SECTIONS, TERMS_TITLE } from "./terms-content";

/**
 * 署名済み利用規約の PDF 用スタンドアロン HTML ビルダー。
 *
 * nda-html と同型。Puppeteer の setContent に渡せる完全な HTML 文字列を生成する。
 * 本番(@sparticuz/chromium)は日本語フォントを内包しないため Noto Serif JP を埋め込む。
 * 文字列は必ず escapeHtml を通す(XSS / 文書構造破壊の防止)。
 *
 * 事業者(当社)の会社名 / 所在地は NDA と同一のため lib/nda/nda-content.ts を再利用する。
 */
export type TermsSignInfo = {
  /** 利用組織名(乙 / 利用者)。 */
  organizationName: string;
  /** 署名者名。未署名(管理画面から未同意状態を表示)のときは null。 */
  signerName: string | null;
  /** 同意日時(ISO 文字列)。未署名のときは null。 */
  acceptedAt: string | null;
  ipAddress?: string | null;
};

function formatJstDateTime(iso: string | null): string {
  if (!iso) return "(未同意)";
  // Asia/Tokyo で "YYYY-MM-DD HH:mm" を返す(UTC ズレを避ける)。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} (JST)`;
}

export function buildTermsHtml(sign: TermsSignInfo): string {
  const acceptedText = formatJstDateTime(sign.acceptedAt);

  const clausesHtml = TERMS_SECTIONS.map((s) => {
    const paragraphs = s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
    const bullets = s.bullets
      ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
      : "";
    return `
    <section class="clause">
      <h2>${escapeHtml(s.heading)}</h2>
      ${paragraphs}
      ${bullets}
    </section>`;
  }).join("\n");

  const ipRow = sign.ipAddress
    ? `<tr><th>IP アドレス</th><td>${escapeHtml(sign.ipAddress)}</td></tr>`
    : "";

  const businessCell = `${escapeHtml(NDA_DISCLOSER_NAME)}${
    NDA_HAS_DISCLOSER_ADDRESS ? `<br>所在地:${escapeHtml(NDA_DISCLOSER_ADDRESS)}` : ""
  }`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(TERMS_TITLE)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; color: #111; background: #fff;
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", "MS Mincho", serif;
    font-size: 11.5px; line-height: 1.8;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; letter-spacing: 0.1em; }
  .updated { text-align: center; font-size: 10px; color: #555; margin-bottom: 16px; }
  .clause { margin: 0 0 10px; break-inside: avoid; }
  .clause h2 { font-size: 12px; margin: 0 0 2px; }
  .clause p { margin: 0 0 3px; text-align: justify; }
  .clause ul { margin: 2px 0 4px; padding-left: 18px; }
  .clause li { margin: 0 0 2px; }
  .sign { margin-top: 22px; border-top: 1px solid #000; padding-top: 12px; break-inside: avoid; }
  .sign h2 { font-size: 12px; margin: 0 0 8px; }
  table.sign-table { width: 100%; border-collapse: collapse; }
  table.sign-table th, table.sign-table td {
    border: 1px solid #000; padding: 5px 8px; font-size: 11px; text-align: left; vertical-align: top;
  }
  table.sign-table th { width: 34%; background: #f6f6f6; font-weight: 500; }
  .note { margin-top: 10px; font-size: 9px; color: #666; }
</style>
</head>
<body>
  <h1>${escapeHtml(TERMS_TITLE)}</h1>
  <div class="updated">最終更新日:${escapeHtml(TERMS_LAST_UPDATED)}</div>
  ${clausesHtml}
  <div class="sign">
    <h2>同意の記録</h2>
    <table class="sign-table">
      <tr><th>事業者</th><td>${businessCell}</td></tr>
      <tr><th>利用組織</th><td>${escapeHtml(sign.organizationName)}</td></tr>
      <tr><th>署名者(氏名)</th><td>${escapeHtml(sign.signerName ?? "(未署名)")}</td></tr>
      <tr><th>同意日時</th><td>${escapeHtml(acceptedText)}</td></tr>
      ${ipRow}
    </table>
    <p class="note">
      本書面は、利用組織の管理者が本サービス上で氏名を入力し「同意する」を選択した記録に基づき電子的に生成されたものです。
    </p>
  </div>
</body>
</html>`;
}
