import { describe, expect, it, vi } from "vitest";

import { getActiveAddons, hasAddon, isAddonActive } from "./entitlements";

describe("isAddonActive", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("status=active かつ current_period_end が未来なら true", () => {
    expect(
      isAddonActive({ status: "active", current_period_end: "2026-12-31T00:00:00Z" }, now),
    ).toBe(true);
  });

  it("status=active で current_period_end が null なら true(無期限扱い)", () => {
    expect(isAddonActive({ status: "active", current_period_end: null }, now)).toBe(true);
  });

  it("status=active でも current_period_end が過去なら false", () => {
    expect(
      isAddonActive({ status: "active", current_period_end: "2026-01-01T00:00:00Z" }, now),
    ).toBe(false);
  });

  it("status=canceled なら期限内でも false", () => {
    expect(
      isAddonActive({ status: "canceled", current_period_end: "2026-12-31T00:00:00Z" }, now),
    ).toBe(false);
  });

  it("status=past_due は false(支払いリトライ中は利用させない)", () => {
    expect(
      isAddonActive({ status: "past_due", current_period_end: "2026-12-31T00:00:00Z" }, now),
    ).toBe(false);
  });
});

/**
 * supabase クライアントは select().eq() のチェイン形式なので
 * 必要なメソッドだけ持つ簡易モックを返す。
 */
function makeSupabaseMock(rows: unknown[] | null, error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from } as never;
}

describe("getActiveAddons / hasAddon", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("active なアドオンだけを返す", async () => {
    const supabase = makeSupabaseMock([
      { addon_key: "meeting_recording_auto", status: "active", current_period_end: null },
    ]);
    const keys = await getActiveAddons(supabase, "user-1", now);
    expect(keys).toEqual(["meeting_recording_auto"]);
  });

  it("canceled / 期限切れ は除外する", async () => {
    const supabase = makeSupabaseMock([
      {
        addon_key: "meeting_recording_auto",
        status: "canceled",
        current_period_end: "2027-01-01T00:00:00Z",
      },
    ]);
    expect(await getActiveAddons(supabase, "user-1", now)).toEqual([]);
  });

  it("クエリエラー時は空配列(=未契約扱い)で安全側に倒す", async () => {
    const supabase = makeSupabaseMock(null, { message: "boom" });
    expect(await getActiveAddons(supabase, "user-1", now)).toEqual([]);
  });

  it("hasAddon は active なら true", async () => {
    const supabase = makeSupabaseMock([
      { addon_key: "meeting_recording_auto", status: "active", current_period_end: null },
    ]);
    expect(await hasAddon(supabase, "user-1", "meeting_recording_auto", now)).toBe(true);
  });

  it("hasAddon は契約無しなら false", async () => {
    const supabase = makeSupabaseMock([]);
    expect(await hasAddon(supabase, "user-1", "meeting_recording_auto", now)).toBe(false);
  });
});
