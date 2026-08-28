import { describe, expect, it } from "vitest";

import {
  buildJobTextFromHtml,
  extractEmbeddedJsonText,
  htmlToText,
  isBlockedIp,
  JOB_URL_MAX_TEXT_CHARS,
} from "./fetch-job-url";

/**
 * SSRF 対策の 中核 = isBlockedIp。ここが 緩むと 内部ネットワーク / メタデータ
 * エンドポイントへの 代理アクセスを 通してしまう ため、境界値を 手厚く 検証する。
 */
describe("isBlockedIp", () => {
  it("プライベート / 予約 IPv4 を ブロックする", () => {
    const blocked = [
      "0.0.0.0",
      "10.0.0.5",
      "100.64.0.1", // CGNAT
      "127.0.0.1",
      "169.254.169.254", // クラウドメタデータ
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1", // マルチキャスト
      "240.0.0.1", // 予約
      "255.255.255.255",
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("公開 IPv4 は 許可する", () => {
    const allowed = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "203.0.114.1", "13.107.42.14"];
    for (const ip of allowed) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("ループバック / リンクローカル / ユニークローカル IPv6 を ブロックする", () => {
    const blocked = [
      "::1",
      "::",
      "fe80::1",
      "fe8a::1",
      "febf::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("非正規表記の IPv6 ループバック / 未指定 も 正規化して ブロックする", () => {
    expect(isBlockedIp("0:0:0:0:0:0:0:1")).toBe(true); // 展開形の ::1
    expect(isBlockedIp("0:0:0:0:0:0:0:0")).toBe(true); // 展開形の ::
  });

  it("IPv4-mapped IPv6 は 一律ブロックする", () => {
    // dotted / 16 進 いずれの mapped 表記も ブロック(DNS は mapped を 返さない ため
    // 実運用の 公開サーバ 到達性には 影響しない)。
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(true);
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true); // 16 進 mapped(=127.0.0.1)
  });

  it("公開 IPv6 は 許可する", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false); // Google
  });

  it("IP として 解釈できない 文字列は 安全側で ブロックする", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
    expect(isBlockedIp("999.999.999.999")).toBe(true);
  });
});

describe("htmlToText", () => {
  it("script / style / コメントを 除去し 本文だけ 残す", () => {
    const html = `
      <html><head><title>営業職の募集</title><style>.x{color:red}</style></head>
      <body>
        <script>alert(1)</script>
        <!-- コメント -->
        <h1>営業スタッフ</h1>
        <p>年収 400〜600 万円</p>
      </body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("コメント");
    expect(text).toContain("営業スタッフ");
    expect(text).toContain("年収 400〜600 万円");
  });

  it("title を ページ先頭に 付与する", () => {
    const text = htmlToText("<title>バックエンドエンジニア</title><body><p>本文</p></body>");
    expect(text.startsWith("【ページタイトル】バックエンドエンジニア")).toBe(true);
  });

  it("HTML エンティティを 復号する", () => {
    const text = htmlToText("<p>R&amp;D 部門&nbsp;募集 &#39;急募&#39; &#x3042;</p>");
    expect(text).toContain("R&D 部門");
    expect(text).toContain("'急募'");
    expect(text).toContain("あ"); // &#x3042;
  });

  it("エンティティを 二重復号しない(&amp;lt; は 文字列 &lt; のまま)", () => {
    const text = htmlToText("<p>比較演算子は &amp;lt; と &amp;gt;</p>");
    expect(text).toContain("&lt;");
    expect(text).toContain("&gt;");
    expect(text).not.toContain("演算子は < と >");
  });

  it("ブロック要素を 改行に 変換して 構造を 残す", () => {
    const text = htmlToText("<p>行1</p><p>行2</p><br>行3");
    expect(text).toContain("行1\n行2");
    expect(text).toContain("行3");
  });

  it("最大文字数で 切り詰める", () => {
    const long = "あ".repeat(JOB_URL_MAX_TEXT_CHARS + 5000);
    const text = htmlToText(`<p>${long}</p>`);
    expect(text.length).toBeLessThanOrEqual(JOB_URL_MAX_TEXT_CHARS);
  });
});

/**
 * SPA(Next.js の __NEXT_DATA__)/ 構造化データ(ld+json)からの本文抽出。
 * 近年の求人サイトは JS 描画でタグ除去だと空になるため、埋め込み JSON を拾えることを検証する。
 */
describe("extractEmbeddedJsonText", () => {
  it("__NEXT_DATA__ の求人データ(日本語文字列)を平坦化して拾う", () => {
    const html = `<html><body><div id="__next"></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            publicJob: {
              job: {
                name: "リフォーム企画営業（経験者枠）",
                minimumQualification: "営業経験1年以上",
                company: { name: "株式会社テスト" },
                id: "abcdefghijklmnopqrstuvwxyz012345", // token っぽい→除外される想定
                url: "https://example.com/job/1", // URL→除外
              },
            },
          },
        },
      })}</script></body></html>`;
    const text = extractEmbeddedJsonText(html);
    expect(text).toContain("リフォーム企画営業（経験者枠）");
    expect(text).toContain("営業経験1年以上");
    expect(text).toContain("株式会社テスト");
    // ノイズ(token/URL)は拾わない
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(text).not.toContain("https://example.com/job/1");
  });

  it("application/ld+json(JobPosting)からも拾う", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "フロントエンドエンジニア",
        hiringOrganization: { name: "サンプル株式会社" },
      })}</script></head><body></body></html>`;
    const text = extractEmbeddedJsonText(html);
    expect(text).toContain("フロントエンドエンジニア");
    expect(text).toContain("サンプル株式会社");
  });

  it("埋め込み JSON が無ければ空文字を返す", () => {
    expect(extractEmbeddedJsonText("<html><body><p>普通の本文</p></body></html>")).toBe("");
  });

  it("壊れた JSON では throw せず空になる", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{壊れ</script>`;
    expect(extractEmbeddedJsonText(html)).toBe("");
  });
});

describe("buildJobTextFromHtml", () => {
  it("SPA(タグ除去では空)でも __NEXT_DATA__ から本文を復元する", () => {
    const html = `<html><body><div id="__next"></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { job: { name: "テスト職種", description: "テストの仕事内容です" } } },
      })}</script></body></html>`;
    const stripped = htmlToText(html);
    const built = buildJobTextFromHtml(html);
    // タグ除去だけではほぼ空だが、build では求人本文が入る
    expect(stripped).not.toContain("テストの仕事内容です");
    expect(built).toContain("テスト職種");
    expect(built).toContain("テストの仕事内容です");
  });

  it("上限で切り詰める", () => {
    const long = "あ".repeat(JOB_URL_MAX_TEXT_CHARS + 5000);
    const html = `<p>${long}</p>`;
    expect(buildJobTextFromHtml(html).length).toBeLessThanOrEqual(JOB_URL_MAX_TEXT_CHARS);
  });
});
