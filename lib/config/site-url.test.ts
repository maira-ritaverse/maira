import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAbsoluteUrl, getSiteUrl } from "./site-url";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SITE_URL;

describe("getSiteUrl", () => {
  beforeEach(() => {
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    if (ORIGINAL_ENV !== undefined) {
      process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ENV;
    } else {
      Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
    }
  });

  it("env が設定済ならそれを返す(末尾スラッシュ除去)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://maira.example.com/";
    expect(getSiteUrl()).toBe("https://maira.example.com");
  });

  it("env が空文字 + production なら fallback", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    vi.stubEnv("NODE_ENV", "production");
    expect(getSiteUrl()).toBe("https://app.maira.pro");
  });

  it("development では localhost:3000 にフォールバック", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("production では https://app.maira.pro にフォールバック", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getSiteUrl()).toBe("https://app.maira.pro");
  });
});

describe("buildAbsoluteUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://maira.example.com";
  });
  afterEach(() => {
    if (ORIGINAL_ENV !== undefined) {
      process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ENV;
    } else {
      Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
    }
  });

  it("先頭スラッシュ付き path をそのまま連結", () => {
    expect(buildAbsoluteUrl("/agency/clients/abc")).toBe(
      "https://maira.example.com/agency/clients/abc",
    );
  });

  it("先頭スラッシュ無し path には自動で / を追加", () => {
    expect(buildAbsoluteUrl("agency/clients/abc")).toBe(
      "https://maira.example.com/agency/clients/abc",
    );
  });

  it("空 path は site URL そのまま", () => {
    expect(buildAbsoluteUrl("")).toBe("https://maira.example.com");
  });
});
