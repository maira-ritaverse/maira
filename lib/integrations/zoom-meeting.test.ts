/**
 * zoom-meeting の純関数ロジックのテスト。
 * 実 API は叩かず、リクエストボディ組み立て部分の不変条件を固定する。
 */
import { describe, expect, it } from "vitest";

import { buildCreateMeetingBody } from "./zoom-meeting";
import { hasMeetingWriteScope } from "./zoom";

describe("buildCreateMeetingBody", () => {
  const baseInput = {
    topic: "○○さんとの初回面談",
    startTime: "2026-07-01T10:00:00",
    durationMinutes: 45,
  };

  it("既定値で type=2 (Scheduled) の会議を作る", () => {
    const body = buildCreateMeetingBody(baseInput);
    expect(body.type).toBe(2);
    expect(body.topic).toBe("○○さんとの初回面談");
    expect(body.duration).toBe(45);
  });

  it("既定 timezone は Asia/Tokyo", () => {
    const body = buildCreateMeetingBody(baseInput);
    expect(body.timezone).toBe("Asia/Tokyo");
  });

  it("timezone を上書きできる", () => {
    const body = buildCreateMeetingBody({ ...baseInput, timezone: "America/Los_Angeles" });
    expect(body.timezone).toBe("America/Los_Angeles");
  });

  it("録画は cloud で自動開始 = Myairaの取込前提条件", () => {
    const body = buildCreateMeetingBody(baseInput);
    const settings = body.settings as Record<string, unknown>;
    expect(settings.auto_recording).toBe("cloud");
  });

  it("Waiting Room と入室時ミュートを有効化", () => {
    const body = buildCreateMeetingBody(baseInput);
    const settings = body.settings as Record<string, unknown>;
    expect(settings.waiting_room).toBe(true);
    expect(settings.mute_upon_entry).toBe(true);
  });

  it("ホスト未到着時の入室は禁止(セキュリティ)", () => {
    const body = buildCreateMeetingBody(baseInput);
    const settings = body.settings as Record<string, unknown>;
    expect(settings.join_before_host).toBe(false);
  });

  it("agenda 未指定は空文字(undefined を JSON に残さない)", () => {
    const body = buildCreateMeetingBody(baseInput);
    expect(body.agenda).toBe("");
  });
});

describe("hasMeetingWriteScope", () => {
  it("Granular の meeting:write:meeting を含む scope なら true", () => {
    expect(hasMeetingWriteScope("user:read:user meeting:read:meeting meeting:write:meeting")).toBe(
      true,
    );
  });

  it("旧 Classic の meeting:write を含む scope も true(後方互換)", () => {
    expect(hasMeetingWriteScope("cloud_recording:read user:read meeting:read meeting:write")).toBe(
      true,
    );
  });

  it("含まれない scope は false", () => {
    expect(hasMeetingWriteScope("cloud_recording:read user:read")).toBe(false);
  });

  it("null / undefined / 空文字 は false", () => {
    expect(hasMeetingWriteScope(null)).toBe(false);
    expect(hasMeetingWriteScope(undefined)).toBe(false);
    expect(hasMeetingWriteScope("")).toBe(false);
  });

  it("部分一致(meeting:write_admin など)は許さない", () => {
    expect(hasMeetingWriteScope("cloud_recording:read meeting:write_admin")).toBe(false);
  });
});
