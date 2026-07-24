/**
 * 求人ページ URL → 本文テキスト 取得ヘルパ(SSRF 対策込み)
 *
 * 用途:
 *   ・エージェントが 求人媒体 / 企業採用ページの URL を 貼り付けると、
 *     サーバー側で HTML を 取得 → 本文テキストに 整形し、
 *     既存の AI 抽出(lib/jobs/ai-extract.ts の extractJobFromText)に 渡す。
 *
 * なぜ SSRF 対策が 必須か:
 *   ・この関数は「ユーザーが 入力した 任意の URL」を サーバーから fetch する。
 *     無防備だと、社内ネットワークや クラウドの メタデータ エンドポイント
 *     (169.254.169.254 等)を 代理で 叩かせる SSRF 攻撃の 踏み台に なりうる。
 *   ・そこで ①スキーム allowlist ②名前解決後の 到達先 IP を 検査して
 *     プライベート / 予約 / ループバック / リンクローカルを 拒否
 *     ③リダイレクトは 手動追跡し 各ホップで 再検証 ④タイムアウト / サイズ上限
 *     ⑤Content-Type は HTML 系のみ、で 多層に 防ぐ。
 *
 * 残存リスク(受容):
 *   ・DNS リバインディング(検査後 fetch 実行までの 一瞬に A レコードを
 *     内部 IP へ 差し替える 高度な 攻撃)は 完全には 塞げない。呼び出し元は
 *     認証済みの 組織メンバー(不特定多数ではない)であり、AI クォータで
 *     頻度も 制限されるため、B2B 用途としては 許容範囲と 判断。将来 脅威が
 *     高まれば undici の 接続 IP ピン留めで 塞ぐ。
 *
 * 外部ライブラリは 使わない(ユーザー方針)。HTML→テキスト整形も 自前の
 * 軽量な タグ除去 + エンティティ復号で 行う。JS 描画の SPA は 取得できない
 * ことが あるが、その場合は PDF / 画像 取り込みに フォールバックできる。
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** fetch 全体の タイムアウト(ミリ秒)。AI 抽出とは 別で、取得のみの 上限。 */
export const JOB_URL_FETCH_TIMEOUT_MS = 15_000;
/** 取得する HTML の 最大バイト数(2.5MB)。巨大ページで メモリを 食わない ように。 */
export const JOB_URL_MAX_BYTES = 2_500_000;
/** AI に 渡す 本文テキストの 最大文字数(トークンコストを 抑える)。 */
export const JOB_URL_MAX_TEXT_CHARS = 30_000;
/**
 * タグ除去 正規表現に かける 前の HTML 最大文字数。
 *
 * htmlToText の タグ除去は 最悪 O(n^2) 的に 効く ため、悪意ある 巨大 HTML
 * (例:閉じない <script> や < の 連続)で CPU を 使い切られない ように、
 * 処理前に 入力を 制限する。出力は どのみち JOB_URL_MAX_TEXT_CHARS に 切り詰める
 * ので、実用上の 情報損失は ほぼ ない。
 */
export const JOB_URL_MAX_HTML_CHARS = 300_000;
/** リダイレクト 追跡の 上限回数。 */
const MAX_REDIRECTS = 3;

const USER_AGENT = "MyairaJobImporter/1.0 (+https://app.maira.pro; 求人票取り込み用の自動取得)";

export type FetchJobUrlFailReason =
  | "invalid_url"
  | "blocked_host"
  | "http_error"
  | "unsupported_content"
  | "too_large"
  | "empty_content"
  | "fetch_error";

export type FetchJobUrlResult =
  | { ok: true; text: string; finalUrl: string }
  | { ok: false; reason: FetchJobUrlFailReason; message: string };

/**
 * IPv4 アドレスを 32bit 整数に 変換(範囲判定用)。不正なら null。
 */
function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let long = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    long = long * 256 + n;
  }
  return long >>> 0;
}

/** [start, end](両端含む)を 32bit で 表す ヘルパ。 */
function inV4Range(long: number, startIp: string, prefix: number): boolean {
  const start = ipv4ToLong(startIp);
  if (start === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (long & mask) === (start & mask);
}

/**
 * IPv6 を 正規形へ 寄せる(WHATWG URL の IPv6 正規化を 借用)。
 *
 * 例:0:0:0:0:0:0:0:1 → ::1、::ffff:7f00:1 → ::ffff:127.0.0.1。
 * これで 非正規な 表記で ループバック / mapped を 忍び込ませる 抜けを 塞ぐ。
 */
function canonicalizeIpv6(ip: string): string {
  try {
    const host = new URL(`http://[${ip}]/`).hostname;
    return host.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return ip.toLowerCase();
  }
}

/**
 * プライベート / 予約 / ループバック / リンクローカル 等の 到達を 禁止すべき
 * IP かを 判定する。IPv4 / IPv6 両対応。
 */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const long = ipv4ToLong(ip);
    if (long === null) return true; // パースできない = 安全側で 拒否
    return (
      inV4Range(long, "0.0.0.0", 8) || // 現ネットワーク
      inV4Range(long, "10.0.0.0", 8) || // プライベート
      inV4Range(long, "100.64.0.0", 10) || // CGNAT
      inV4Range(long, "127.0.0.0", 8) || // ループバック
      inV4Range(long, "169.254.0.0", 16) || // リンクローカル(メタデータ 169.254.169.254 含む)
      inV4Range(long, "172.16.0.0", 12) || // プライベート
      inV4Range(long, "192.0.0.0", 24) || // IETF プロトコル割当
      inV4Range(long, "192.0.2.0", 24) || // TEST-NET-1
      inV4Range(long, "192.168.0.0", 16) || // プライベート
      inV4Range(long, "198.18.0.0", 15) || // ベンチマーク
      inV4Range(long, "198.51.100.0", 24) || // TEST-NET-2
      inV4Range(long, "203.0.113.0", 24) || // TEST-NET-3
      inV4Range(long, "224.0.0.0", 4) || // マルチキャスト
      inV4Range(long, "240.0.0.0", 4) // 予約
    );
  }
  if (kind === 6) {
    const lower = canonicalizeIpv6(ip);
    // IPv4-mapped(::ffff:a.b.c.d)は 一律ブロック。canonicalizeIpv6 が dotted を
    // 16 進 hextet(::ffff:7f00:1)へ 正規化する ため 埋め込み IPv4 を 安全に
    // 取り出せない。DNS 解決は IPv4 を family 4 の dotted で 返す(mapped では
    // 返さない)ので、mapped を 全拒否しても 実運用の 到達性には 影響しない。
    if (lower.includes("::ffff:")) return true;
    if (lower === "::1" || lower === "::") return true; // ループバック / 未指定
    // リンクローカル fe80::/10 = 先頭 hextet 0xfe80〜0xfebf(fe8x / fe9x / feax / febx)
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    )
      return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ユニークローカル fc00::/7
    if (lower.startsWith("ff")) return true; // マルチキャスト
    return false;
  }
  // IP として 解釈できない 文字列は 安全側で 拒否
  return true;
}

/**
 * URL 文字列を 検証して URL オブジェクトを 返す。
 * スキームは http / https のみ、IP リテラル指定は その場で ブロック判定。
 */
function parseAndValidateUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; reason: FetchJobUrlFailReason; message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid_url", message: "URL の形式が正しくありません。" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: "invalid_url",
      message: "http または https で始まる URL を入力してください。",
    };
  }
  if (!url.hostname) {
    return { ok: false, reason: "invalid_url", message: "URL のホスト名が読み取れません。" };
  }
  // ホスト名が IP リテラルなら DNS を 引かず その場で 判定
  const bracketStripped = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bracketStripped) && isBlockedIp(bracketStripped)) {
    return {
      ok: false,
      reason: "blocked_host",
      message: "このアドレスの取得は許可されていません。",
    };
  }
  return { ok: true, url };
}

/**
 * ホスト名を 名前解決し、返ってきた 全 IP が 許可範囲か 検証する。
 * 1 つでも プライベート / 予約 IP を 含む 場合は 拒否(DNS で 内部 IP を
 * 指す 攻撃を 防ぐ)。
 */
async function assertHostResolvesPublic(
  hostname: string,
): Promise<{ ok: true } | { ok: false; reason: FetchJobUrlFailReason; message: string }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    return isBlockedIp(host)
      ? { ok: false, reason: "blocked_host", message: "このアドレスの取得は許可されていません。" }
      : { ok: true };
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return {
      ok: false,
      reason: "fetch_error",
      message: "ホスト名を解決できませんでした。URL を確認してください。",
    };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "fetch_error", message: "ホスト名を解決できませんでした。" };
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      return {
        ok: false,
        reason: "blocked_host",
        message: "このアドレスの取得は許可されていません。",
      };
    }
  }
  return { ok: true };
}

/** Content-Type の charset、無ければ HTML の meta から 文字コードを 推定。 */
function detectCharset(contentType: string, buf: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType);
  if (fromHeader) return normalizeCharset(fromHeader[1]);
  // meta charset を 先頭 2KB から 拾う(日本語サイトの Shift_JIS / EUC-JP 対策)
  const head = buf.subarray(0, 2048).toString("latin1");
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ?? /charset=["']?([\w-]+)/i.exec(head);
  if (fromMeta) return normalizeCharset(fromMeta[1]);
  return "utf-8";
}

function normalizeCharset(label: string): string {
  const l = label.toLowerCase();
  if (l === "sjis" || l === "x-sjis" || l === "shift-jis" || l === "shift_jis") return "shift_jis";
  if (l === "euc-jp" || l === "eucjp" || l === "x-euc-jp") return "euc-jp";
  return l;
}

/** Response body を サイズ上限付きで 読み取り、文字コードを 考慮して デコードする。 */
async function readBodyCapped(
  res: Response,
  contentType: string,
): Promise<
  { ok: true; text: string } | { ok: false; reason: FetchJobUrlFailReason; message: string }
> {
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    // ヘッダ受信後の 本文ストリーミング中も タイムアウト(AbortController)や
    // 接続断が 起きうる。ここで catch しないと reader.read() の reject が
    // route まで 素通りして 500(HTML)に なり、タイムアウト用の 案内文が 出ない。
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > JOB_URL_MAX_BYTES) {
            await reader.cancel();
            return {
              ok: false,
              reason: "too_large",
              message: `ページが大きすぎます(上限 ${Math.round(JOB_URL_MAX_BYTES / 1024 / 1024)}MB)。`,
            };
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        reason: "fetch_error",
        message: aborted
          ? "ページの取得がタイムアウトしました。時間を置いて再度お試しください。"
          : "ページの取得中に接続が切れました。時間を置いて再度お試しください。",
      };
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const charset = detectCharset(contentType, buf);
  let text: string;
  try {
    // fatal:false で 未対応/壊れたバイトは 置換文字に して 落とさない
    text = new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
  return { ok: true, text };
}

/** HTML から 本文テキストを 抽出(タグ除去 + エンティティ復号 + 空白整形)。 */
export function htmlToText(rawHtml: string): string {
  // タグ除去 正規表現は 最悪 O(n^2)。巨大 / 悪意ある 入力で CPU を 使い切られない
  // ように、処理前に 入力長を 制限する(出力は どのみち 切り詰める)。あわせて
  // 量指定子を 有界({0,N})に して、閉じない タグ / < の 連続 での 破滅的
  // バックトラックを 防ぐ。
  const html =
    rawHtml.length > JOB_URL_MAX_HTML_CHARS ? rawHtml.slice(0, JOB_URL_MAX_HTML_CHARS) : rawHtml;

  // タイトルは 職種/企業名の 手がかりに なるので 先に 退避
  const titleMatch = /<title[^>]{0,2000}>([\s\S]{0,5000}?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : "";

  let text = html
    // コメント / スクリプト / スタイル / 非表示要素を 丸ごと 除去
    .replace(/<!--[\s\S]{0,100000}?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]{0,100000}?<\/\1>/gi, " ")
    // ブロック要素の 終わり / 改行タグは 改行に(構造を 残して AI が 読みやすく)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|header|footer|li|tr|h[1-6]|ul|ol|table|dl|dt|dd)\s*>/gi,
      "\n",
    )
    .replace(/<(h[1-6])\b[^>]{0,20000}>/gi, "\n")
    // 残りの タグを すべて 除去
    .replace(/<[^>]{0,20000}>/g, " ");

  text = decodeEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const withTitle = title ? `【ページタイトル】${title}\n\n${text}` : text;
  return withTitle.slice(0, JOB_URL_MAX_TEXT_CHARS);
}

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * HTML エンティティを 復号(数値参照 + よく使う 名前付き参照)。
 *
 * 単一パスで 置換する(チェーン .replace だと `&amp;lt;` が `&` → `<` と
 * 二重復号される バグに なる。1 回の replace で 元文字列を 左→右に 走査すれば
 * 置換結果は 再走査されない ので 二重復号を 防げる)。
 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match: string, body: string): string => {
    if (body.charCodeAt(0) === 35 /* '#' */) {
      const isHex = body[1] === "x" || body[1] === "X";
      const cp = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const decoded = safeFromCodePoint(cp);
      return decoded === "" ? match : decoded;
    }
    // 未知の 名前付き参照(&copy; 等)は 変換せず そのまま 残す
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * 求人ページ URL を 取得して 本文テキストを 返す。
 *
 * リダイレクトは 手動追跡し、各ホップで URL 検証 + 名前解決チェックを 再実行する
 * (最初の URL だけ 検証して 追跡を SDK 任せに すると、リダイレクト先で 内部 IP へ
 * 飛ばす SSRF を 通してしまう)。
 */
export async function fetchJobPageText(rawUrl: string): Promise<FetchJobUrlResult> {
  const first = parseAndValidateUrl(rawUrl);
  if (!first.ok) return first;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_URL_FETCH_TIMEOUT_MS);
  try {
    let currentUrl = first.url.href;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const validated = parseAndValidateUrl(currentUrl);
      if (!validated.ok) return validated;

      const hostCheck = await assertHostResolvesPublic(validated.url.hostname);
      if (!hostCheck.ok) return hostCheck;

      let res: Response;
      try {
        res = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual", // 自分で 各ホップを 検証したいので 自動追跡しない
          signal: controller.signal,
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "ja,en;q=0.8",
          },
        });
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        return {
          ok: false,
          reason: "fetch_error",
          message: aborted
            ? "ページの取得がタイムアウトしました。時間を置いて再度お試しください。"
            : "ページを取得できませんでした。URL を確認してください。",
        };
      }

      // リダイレクト(3xx + Location)なら 検証しつつ 次のホップへ
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return { ok: false, reason: "fetch_error", message: "リダイレクト先が不正です。" };
        }
        let next: string;
        try {
          next = new URL(location, currentUrl).href;
        } catch {
          return { ok: false, reason: "fetch_error", message: "リダイレクト先の URL が不正です。" };
        }
        currentUrl = next;
        continue;
      }

      if (!res.ok) {
        return {
          ok: false,
          reason: "http_error",
          message: `ページの取得に失敗しました(HTTP ${res.status})。URL が正しいか、公開されているか確認してください。`,
        };
      }

      const contentType = res.headers.get("content-type") ?? "";
      // HTML 系以外(PDF / 画像 / JSON 等)は この機能の 対象外
      if (
        contentType &&
        !/text\/html|application\/xhtml\+xml|text\/plain|application\/xml/i.test(contentType)
      ) {
        return {
          ok: false,
          reason: "unsupported_content",
          message:
            "このURLはWebページ(HTML)ではありません。PDF や画像の場合は「PDF / 画像から AI 取り込み」をご利用ください。",
        };
      }

      const body = await readBodyCapped(res, contentType);
      if (!body.ok) return body;

      const text = htmlToText(body.text);
      if (text.length < 20) {
        return {
          ok: false,
          reason: "empty_content",
          message:
            "ページから本文を読み取れませんでした。JavaScript で表示されるページの可能性があります。PDF / 画像での取り込みをお試しください。",
        };
      }
      return { ok: true, text, finalUrl: currentUrl };
    }

    return {
      ok: false,
      reason: "fetch_error",
      message: "リダイレクトが多すぎます。URL を確認してください。",
    };
  } finally {
    clearTimeout(timer);
  }
}
