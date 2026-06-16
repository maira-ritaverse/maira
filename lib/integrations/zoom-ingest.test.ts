import { describe, expect, it } from "vitest";

import { guessExt, pickAudioFile, type ZoomRecordingFile } from "./zoom-ingest";

function file(overrides: Partial<ZoomRecordingFile>): ZoomRecordingFile {
  return {
    id: "id",
    download_url: "https://example.com/file.mp4",
    file_type: "MP4",
    ...overrides,
  };
}

describe("pickAudioFile", () => {
  it("空配列は null", () => {
    expect(pickAudioFile([])).toBeNull();
  });

  it("recording_type=audio_only を最優先", () => {
    const a = file({ id: "audio", recording_type: "audio_only", file_type: "M4A" });
    const v = file({ id: "video", recording_type: "shared_screen", file_type: "MP4" });
    expect(pickAudioFile([v, a])?.id).toBe("audio");
  });

  it(".m4a 拡張子も audio_only 判定", () => {
    const a = file({ id: "x", download_url: "https://x.example/recording.m4a" });
    const v = file({ id: "y", file_type: "mp4" });
    expect(pickAudioFile([v, a])?.id).toBe("x");
  });

  it("audio_only が無ければ MP4 にフォールバック", () => {
    const v = file({ id: "m", file_type: "MP4" });
    const other = file({ id: "o", file_type: "TIMELINE" });
    expect(pickAudioFile([other, v])?.id).toBe("m");
  });

  it("MP4 すら無ければ null", () => {
    const other = file({ id: "x", file_type: "TIMELINE" });
    expect(pickAudioFile([other])).toBeNull();
  });
});

describe("guessExt", () => {
  it("URL から拡張子を取り出す", () => {
    expect(guessExt("MP4", "https://x.example/foo.mp4")).toBe("mp4");
    expect(guessExt("M4A", "https://x.example/recording.m4a")).toBe("m4a");
  });

  it("クエリ文字列付きでも拡張子だけ取る", () => {
    expect(guessExt("", "https://x.example/foo.mp4?access_token=abc")).toBe("mp4");
  });

  it("拡張子が無ければ file_type fallback", () => {
    expect(guessExt("MP4", "https://x.example/file?id=123")).toBe("mp4");
  });

  it("どちらも無ければ m4a", () => {
    expect(guessExt("", "")).toBe("m4a");
  });
});
