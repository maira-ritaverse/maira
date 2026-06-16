import { describe, expect, it, vi } from "vitest";

import {
  JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY,
  JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY,
  PHOTO_ENHANCE_ADDON_MONTHLY,
  PHOTO_ENHANCE_FREE_MONTHLY,
  checkAiUsageLimit,
  countAiUsageThisMonth,
} from "./ai-usage";

function makeSupabase({
  addons,
  usageCount,
  usageError = null,
}: {
  addons: unknown[];
  usageCount: number;
  usageError?: unknown;
}) {
  // subscription_addons: select(...).eq(user_id)
  const eqAddons = vi.fn().mockResolvedValue({ data: addons, error: null });
  const selectAddons = vi.fn().mockReturnValue({ eq: eqAddons });

  // ai_usage_events: select(...).eq(user_id).eq(kind).gte(created_at)
  const gte = vi.fn().mockResolvedValue({ count: usageCount, error: usageError });
  const eqKind = vi.fn().mockReturnValue({ gte });
  const eqUser = vi.fn().mockReturnValue({ eq: eqKind });
  const selectUsage = vi.fn().mockReturnValue({ eq: eqUser });

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "subscription_addons") return { select: selectAddons };
    if (table === "ai_usage_events") return { select: selectUsage };
    throw new Error(`unexpected table: ${table}`);
  });
  return { from } as never;
}

const now = new Date("2026-06-22T00:00:00Z");

describe("countAiUsageThisMonth", () => {
  it("count を返す", async () => {
    const s = makeSupabase({ addons: [], usageCount: 3 });
    expect(await countAiUsageThisMonth(s, "u", "photo_enhance", now)).toBe(3);
  });

  it("エラー時は MAX_SAFE_INTEGER で安全側", async () => {
    const s = makeSupabase({ addons: [], usageCount: 0, usageError: { m: "x" } });
    expect(await countAiUsageThisMonth(s, "u", "photo_enhance", now)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("checkAiUsageLimit: photo_enhance", () => {
  it("フリー: 5 件未満なら allowed", async () => {
    const s = makeSupabase({ addons: [], usageCount: 2 });
    const r = await checkAiUsageLimit(s, "u", "photo_enhance", now);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(PHOTO_ENHANCE_FREE_MONTHLY);
    expect(r.addon).toBe(false);
  });

  it("フリー: 上限到達なら allowed=false", async () => {
    const s = makeSupabase({ addons: [], usageCount: PHOTO_ENHANCE_FREE_MONTHLY });
    const r = await checkAiUsageLimit(s, "u", "photo_enhance", now);
    expect(r.allowed).toBe(false);
  });

  it("アドオン契約者: 上限が拡張", async () => {
    const s = makeSupabase({
      addons: [
        {
          addon_key: "meeting_recording_auto",
          status: "active",
          current_period_end: null,
        },
      ],
      usageCount: PHOTO_ENHANCE_FREE_MONTHLY + 10,
    });
    const r = await checkAiUsageLimit(s, "u", "photo_enhance", now);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(PHOTO_ENHANCE_ADDON_MONTHLY);
    expect(r.addon).toBe(true);
  });
});

describe("checkAiUsageLimit: job_recommendation_seeker", () => {
  it("フリー: 20 件まで", async () => {
    const s = makeSupabase({ addons: [], usageCount: 15 });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_seeker", now);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY);
  });

  it("アドオン: 200 件まで", async () => {
    const s = makeSupabase({
      addons: [
        {
          addon_key: "meeting_recording_auto",
          status: "active",
          current_period_end: null,
        },
      ],
      usageCount: 100,
    });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_seeker", now);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY);
  });
});
