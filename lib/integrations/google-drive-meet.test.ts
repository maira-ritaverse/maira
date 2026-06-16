import { describe, expect, it } from "vitest";

import { guessExtFromMime, sanitizeFilename } from "./google-drive-meet";

describe("guessExtFromMime", () => {
  it("video/mp4 → mp4", () => {
    expect(guessExtFromMime("video/mp4")).toBe("mp4");
  });
  it("audio/m4a → m4a", () => {
    expect(guessExtFromMime("audio/m4a")).toBe("m4a");
  });
  it("未対応 mime は空文字", () => {
    expect(guessExtFromMime("audio/wav")).toBe("");
    expect(guessExtFromMime("")).toBe("");
  });
});

describe("sanitizeFilename", () => {
  it("既存拡張子を外す", () => {
    expect(sanitizeFilename("Meet Recording.mp4")).toBe("Meet Recording");
    expect(sanitizeFilename("ファイル名.m4a")).toBe("ファイル名");
  });
  it("Windows 禁則文字を _ に置換", () => {
    expect(sanitizeFilename('a\\b/c:d*e?f"g<h>i|j.mp4')).toBe("a_b_c_d_e_f_g_h_i_j");
  });
  it("80 文字で切り詰める", () => {
    const long = "x".repeat(120);
    expect(sanitizeFilename(long).length).toBe(80);
  });
  it("拡張子なしでも動く", () => {
    expect(sanitizeFilename("Meet_Recording_2026-06-15")).toBe("Meet_Recording_2026-06-15");
  });
  it("日本語ファイル名は維持", () => {
    expect(sanitizeFilename("Meet 録画 2026-06-15.mp4")).toBe("Meet 録画 2026-06-15");
  });
});
