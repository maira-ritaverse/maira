/**
 * HTML エスケープ(XSS 防御の共通実装)
 *
 * 履歴書 PDF(lib/resumes/resume-html.ts)と職務経歴書 PDF(lib/cvs/cv-html.ts)で
 * ユーザー入力をテンプレートリテラルに埋め込む箇所で必ず通す。
 *
 * これを忘れると `</body>` や `<script>` を仕込まれて以下のリスクが発生する:
 *   - Puppeteer 内での任意スクリプト実行
 *   - PDF 出力の文書構造破壊(タグの早閉じで以降が空になる)
 *
 * 以前は同じ実装が 2 ファイルに重複していたため、片方だけ修正される事故防止の
 * ためにここに集約。挙動を変える場合は lib/html/escape.test.ts も同時に更新する。
 *
 * エスケープ対象(5 文字、HTML5 仕様の最小集合):
 *   & → &amp;   (最初に置換することで他の置換結果に二重 amp が付くのを防ぐ)
 *   < → &lt;
 *   > → &gt;
 *   " → &quot;
 *   ' → &#39;   (古いブラウザで &apos; が解釈できない環境向け)
 *
 * 注意:
 *   - URL コンテキスト(href / src)では encodeURIComponent も併用するのが本来の安全策。
 *     本関数は HTML テキストノード / 属性値の両方で「最低限の閉じタグ漏洩」を防ぐ。
 *   - バッククォート ` は HTML 文脈ではエスケープ不要(JS テンプレートリテラル内に
 *     生で残せる)。escape する必要は無いが、将来 backtick 関連の attack ベクトルが
 *     見つかったらここに追加する。
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
