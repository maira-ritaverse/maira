import { describe, expect, it } from "vitest";

import {
  PREFLIGHT_MAX_BYTES,
  PREFLIGHT_MIN_DURATION_SECONDS,
  PREFLIGHT_RECOMMENDED_MIN_DURATION_SECONDS,
  preflightAudioFile,
} from "./preflight";

/**
 * preflight のテスト。
 *
 * probeDuration() は HTMLMediaElement(jsdom 非対応)を使うため、
 * 純粋な node 環境では duration=null が返る。
 * 「ブロッキングルール(サイズ / MIME)」と「duration 不明時の警告」を確認。
 */

function mockFile({
  name = "test.mp3",
  type = "audio/mpeg",
  size = 1024 * 1024,
}: { name?: string; type?: string; size?: number } = {}): File {
  // node 環境では window が無いので File が無い場合は polyfill 風に作る
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type, lastModified: Date.now() });
}

describe("preflightAudioFile", () => {
  it("正常サイズ + 正常 MIME はブロッキングなし", async () => {
    const r = await preflightAudioFile(mockFile());
    expect(r.ok).toBe(true);
    // node 環境では duration が取れない → warning が 1 件入る
    expect(r.durationSeconds).toBeNull();
    expect(r.issues.filter((i) => i.level === "blocking")).toHaveLength(0);
  });

  it("サイズ超過は blocking", async () => {
    const r = await preflightAudioFile(mockFile({ size: PREFLIGHT_MAX_BYTES + 1 }));
    expect(r.ok).toBe(false);
    const blocking = r.issues.find((i) => i.level === "blocking");
    expect(blocking?.code).toBe("too_large");
  });

  it("未知の MIME + 未知の拡張子は blocking", async () => {
    const r = await preflightAudioFile(mockFile({ type: "application/zip", name: "x.zip" }));
    expect(r.ok).toBe(false);
    const blocking = r.issues.find((i) => i.level === "blocking");
    expect(blocking?.code).toBe("unsupported_format");
  });

  it("MIME 不明でも拡張子が有効なら通る(Safari の MOV 等)", async () => {
    const r = await preflightAudioFile(mockFile({ type: "", name: "interview.mov" }));
    const blocking = r.issues.find((i) => i.level === "blocking");
    expect(blocking).toBeUndefined();
  });

  it("duration が取得できない場合は warning を出す(node 環境では常にこれ)", async () => {
    const r = await preflightAudioFile(mockFile());
    expect(r.issues.some((i) => i.code === "duration_unknown")).toBe(true);
  });

  it("PREFLIGHT 定数は明示的に大きさ・時間が分かる値である", () => {
    expect(PREFLIGHT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(PREFLIGHT_MIN_DURATION_SECONDS).toBeLessThan(PREFLIGHT_RECOMMENDED_MIN_DURATION_SECONDS);
  });
});
