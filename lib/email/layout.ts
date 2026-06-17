/**
 * メール HTML 共通レイアウト
 *
 * Maira ブランドのフッターを統一する。
 * 各メールの本文(中央のカード部分)だけを innerHtml として受け取り、
 * 同じヘッダー/フッターで包む。
 */

export type EmailLayoutArgs = {
  /** タイトル(<title> タグに使う。受信箱でのプレビューに使われる) */
  previewTitle: string;
  /** メール本体の HTML(例:見出し + 説明 + ボタン) */
  bodyHtml: string;
};

export function renderEmailLayout({ previewTitle, bodyHtml }: EmailLayoutArgs): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(previewTitle)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <tr>
            <td style="padding:24px 28px 8px;">
              <div style="font-size:14px;font-weight:700;letter-spacing:0.05em;color:#111;">Maira</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;">
              <hr style="border:none;border-top:1px solid #e6e6e6;margin:0 0 12px;">
              <p style="margin:0;font-size:12px;color:#888;line-height:1.6;">
                Maira(マイラ)— 20-30代の転職活動者のための AI キャリアエージェント<br>
                <a href="https://maira.pro" style="color:#666;text-decoration:none;">https://maira.pro</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** メール本文用の主要ボタン(黒背景)。href は HTML 属性エスケープして XSS を防ぐ。 */
export function primaryButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>`;
}

/** メール本文用の副ボタン(白背景・枠線)。href は HTML 属性エスケープして XSS を防ぐ。 */
export function secondaryButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;background:#fff;color:#111;text-decoration:none;border:1px solid #d0d0d0;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>`;
}

/** ラベル + 値の 1 行(meta info カード用) */
export function infoRow(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:14px;">
  <span style="color:#666;">${escapeHtml(label)}</span>
  <span style="color:#111;font-weight:500;">${escapeHtml(value)}</span>
</div>`;
}

/** info カード(背景グレーの情報枠) */
export function infoCard(innerHtml: string): string {
  return `<div style="background:#f6f7f9;border-radius:8px;padding:14px 16px;margin:16px 0;">${innerHtml}</div>`;
}

/** HTML エスケープ */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
