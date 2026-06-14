import { describe, it, expect } from "vitest";
import { csvResponse } from "./response";

/**
 * csvResponse のテスト。
 *
 * 主に Content-Disposition の filename / filename*= 両併記が正しく組み立たること、
 * Content-Type が UTF-8 指定であること、ブラウザのキャッシュが効かないことを確認。
 * 「日本語ファイル名でも壊れない」ことが本関数の主目的。
 */

describe("csvResponse", () => {
  it("Content-Type は text/csv; charset=utf-8 で UTF-8 を明示する", async () => {
    const res = csvResponse("a,b,c\r\n", "test.csv");
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  });

  it("Content-Disposition に attachment と ASCII safe filename を含む", () => {
    const res = csvResponse("body", "clients.csv");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("attachment");
    expect(cd).toContain('filename="clients.csv"');
    // ASCII のみのファイル名でも filename*= は常に付ける契約
    expect(cd).toContain("filename*=UTF-8''clients.csv");
  });

  it("日本語ファイル名は ASCII fallback を _ に置換しつつ RFC 5987 で UTF-8 版を併記", () => {
    const res = csvResponse("body", "クライアント.csv");
    const cd = res.headers.get("content-disposition") ?? "";
    // ASCII safe 版:非 ASCII を _ に置換(クライアント = 6 文字 → _ 6 個)
    expect(cd).toContain('filename="______.csv"');
    // RFC 5987 版:percent-encoded
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent("クライアント.csv")}`);
  });

  it("cache-control は no-store(古いキャッシュを掴ませない)", () => {
    const res = csvResponse("body", "x.csv");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("body のバイト列は透過する(BOM 付きでも先頭バイトに 0xEF 0xBB 0xBF が残る)", async () => {
    // BOM は U+FEFF。Response.text() の TextDecoder は標準で BOM を剥がすので
    // バイト列レベルで検証する(BOM が落ちると Excel が文字化けするため、ここが本丸)。
    const body = "﻿a\r\nb\r\n";
    const res = csvResponse(body, "x.csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    // 残りは "a\r\nb\r\n" の ASCII バイト
    expect(new TextDecoder("utf-8").decode(bytes.slice(3))).toBe("a\r\nb\r\n");
  });

  it("status は 200", () => {
    const res = csvResponse("body", "x.csv");
    expect(res.status).toBe(200);
  });
});
