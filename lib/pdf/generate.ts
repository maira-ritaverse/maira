/**
 * Puppeteer ベースの PDF 生成ユーティリティ
 *
 * ※ このモジュールは API ルート(Node ランタイム)からのみ呼び出すこと。
 *    クライアントから import すると puppeteer 一式がバンドルに入って壊れる。
 *
 * ローカルと本番(Vercel)で Chromium の調達方法が異なるため、環境分岐を入れる:
 *
 * - ローカル: `puppeteer` (devDep) を使う。post-install で Chromium バイナリを
 *   ~/.cache/puppeteer にダウンロード済みのため、追加設定なしで動く。
 * - 本番(Vercel): `puppeteer-core` + `@sparticuz/chromium-min`。Lambda 系
 *   サーバーレス環境向けに最適化された Chromium を使う。
 *   @sparticuz/chromium-min はバイナリを内包しないため、別途リモートから
 *   取得する必要がある(CHROMIUM_REMOTE_EXEC_PATH 環境変数で URL を指定)。
 *   ※今回は形だけ用意し、本番動作確認は次フェーズで行う。
 *
 * 日本語文字化け対策:
 * - HTML 側で Google Fonts (Noto Sans JP / Noto Serif JP) を読み込む
 * - page.setContent 後に networkidle0 で Web フォントの取得を待つ
 * - さらに document.fonts.ready で適用完了まで待つ
 *
 * dynamic import の理由:
 * - puppeteer / chromium-min はサイズが大きく、Next.js のビルド時に静的解析
 *   される import だと本番バンドルに含まれてしまう。await import で実行時に
 *   分岐ロードすることで、不要な側はバンドルされない。
 */

const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

export async function generatePdfFromHtml(html: string): Promise<Buffer> {
  // unknown で受けるのは puppeteer / puppeteer-core で型が微妙に違うため。
  // ここでは launch / newPage / pdf / close しか触らないので簡略化する。
  let browser: { newPage: () => Promise<PuppeteerPage>; close: () => Promise<void> };

  if (isProduction) {
    // ===== 本番(Vercel) =====
    const chromiumModule = await import("@sparticuz/chromium-min");
    const chromium = chromiumModule.default;
    const puppeteerCoreModule = await import("puppeteer-core");
    const puppeteerCore = puppeteerCoreModule.default;

    const remoteExecPath = process.env.CHROMIUM_REMOTE_EXEC_PATH;
    if (!remoteExecPath) {
      // 本番に出る前に必ず設定する必要がある旨を明示。
      throw new Error(
        "CHROMIUM_REMOTE_EXEC_PATH が未設定です(本番では @sparticuz/chromium-min の remote binary URL を環境変数で指定してください)。",
      );
    }
    const executablePath = await chromium.executablePath(remoteExecPath);

    browser = (await puppeteerCore.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    })) as unknown as typeof browser;
  } else {
    // ===== ローカル開発 =====
    const puppeteerModule = await import("puppeteer");
    const puppeteer = puppeteerModule.default;
    browser = (await puppeteer.launch({ headless: true })) as unknown as typeof browser;
  }

  try {
    const page = await browser.newPage();

    // setContent 時に Web フォント(Google Fonts)を取得し終えるまで待つ。
    // networkidle0 = ネットワーク接続が 500ms 以上ゼロになるまで待機。
    await page.setContent(html, { waitUntil: "networkidle0" });

    // CSS のフォント読み込み完了(document.fonts.ready)を念のため明示的に待つ。
    // これを省くと、ネットワークは静かでもフォント適用が間に合わずに豆腐になる
    // ケースが報告されている。
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // HTML 側の @page で margin: 0、各 .page で padding: 10mm を取っているので
      // ここでは追加マージンを置かない(二重マージンの防止)。
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      preferCSSPageSize: true,
    });

    // puppeteer の pdf() は Uint8Array / Buffer のどちらかを返すバージョン差があるため
    // 明示的に Buffer に揃える(Next.js の Response にそのまま渡せるように)。
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// Puppeteer の Page を最小限の構造だけ型付け。
// puppeteer / puppeteer-core の Page を直接 import すると、本番では
// devDependency の puppeteer が型解決できないなど面倒が起きるので最小型で受ける。
type PuppeteerPage = {
  setContent: (html: string, options?: { waitUntil?: string }) => Promise<void>;
  evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
  pdf: (options: {
    format?: string;
    printBackground?: boolean;
    margin?: { top: string; right: string; bottom: string; left: string };
    preferCSSPageSize?: boolean;
  }) => Promise<Buffer | Uint8Array>;
};
