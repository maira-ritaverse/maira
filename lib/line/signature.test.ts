import { createHmac } from "crypto";

import { describe, expect, it } from "vitest";

import { verifyLineSignature } from "./signature";

const CHANNEL_SECRET = "abcdef0123456789abcdef0123456789";

function sign(body: string): string {
  return createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64");
}

describe("verifyLineSignature", () => {
  it("正しい 署名 で true", () => {
    const body = '{"events":[]}';
    expect(verifyLineSignature(body, sign(body), CHANNEL_SECRET)).toBe(true);
  });

  it("body が 1 文字 でも 違えば false", () => {
    const body = '{"events":[]}';
    const sig = sign(body);
    expect(verifyLineSignature(body + " ", sig, CHANNEL_SECRET)).toBe(false);
  });

  it("署名 が null なら false", () => {
    expect(verifyLineSignature("{}", null, CHANNEL_SECRET)).toBe(false);
  });

  it("署名 が 空文字 なら false", () => {
    expect(verifyLineSignature("{}", "", CHANNEL_SECRET)).toBe(false);
  });

  it("別 Secret で 署名 された もの は false", () => {
    const body = '{"events":[]}';
    const sigByOther = createHmac("sha256", "other_secret_xxxxxxxxxxxxxxxxx")
      .update(body)
      .digest("base64");
    expect(verifyLineSignature(body, sigByOther, CHANNEL_SECRET)).toBe(false);
  });

  it("不正 形式 の 署名 でも crash しない (false 返却)", () => {
    expect(verifyLineSignature("{}", "!!!!", CHANNEL_SECRET)).toBe(false);
  });
});
