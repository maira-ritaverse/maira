import { describe, expect, it, vi } from "vitest";

import {
  INTAKE_ADDON_MONTHLY_LIMIT,
  INTAKE_FREE_MONTHLY_LIMIT,
  checkIntakeLimit,
  countIntakesInCurrentMonth,
  utcMonthStart,
  utcNextMonthStart,
} from "./usage-limits";

describe("utcMonthStart / utcNextMonthStart", () => {
  it("月初を UTC で返す", () => {
    const d = new Date("2026-06-15T12:34:56Z");
    expect(utcMonthStart(d).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("翌月初を UTC で返す(12 月でも年繰り上がり)", () => {
    expect(utcNextMonthStart(new Date("2026-12-15T00:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

/**
 * 二段モック:
 *   1) subscription_addons の select(...).eq(user_id) — getActiveAddons で使う
 *   2) career_intake_recordings の select(..., {count:'exact', head:true}).eq().gte()
 *
 * from(table) の呼び分けで返り値を変える。
 */
function makeSupabase({
  addons,
  intakeCount,
  intakeError = null,
}: {
  addons: unknown[];
  intakeCount: number;
  intakeError?: unknown;
}) {
  const eqAddons = vi.fn().mockResolvedValue({ data: addons, error: null });
  const selectAddons = vi.fn().mockReturnValue({ eq: eqAddons });

  const gte = vi.fn().mockResolvedValue({ count: intakeCount, error: intakeError });
  const eqIntake = vi.fn().mockReturnValue({ gte });
  const selectIntake = vi.fn().mockReturnValue({ eq: eqIntake });

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "subscription_addons") return { select: selectAddons };
    if (table === "career_intake_recordings") return { select: selectIntake };
    throw new Error(`unexpected table: ${table}`);
  });

  return { from } as never;
}

describe("countIntakesInCurrentMonth", () => {
  it("count を返す", async () => {
    const supabase = makeSupabase({ addons: [], intakeCount: 2 });
    expect(await countIntakesInCurrentMonth(supabase, "user-1")).toBe(2);
  });

  it("エラー時は MAX_SAFE_INTEGER(= 利用不可側)", async () => {
    const supabase = makeSupabase({
      addons: [],
      intakeCount: 0,
      intakeError: { message: "boom" },
    });
    expect(await countIntakesInCurrentMonth(supabase, "user-1")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("checkIntakeLimit", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("フリー: 上限未満なら allowed=true、limit=FREE", async () => {
    const supabase = makeSupabase({ addons: [], intakeCount: 1 });
    const s = await checkIntakeLimit(supabase, "user-1", now);
    expect(s.allowed).toBe(true);
    expect(s.limit).toBe(INTAKE_FREE_MONTHLY_LIMIT);
    expect(s.addon).toBe(false);
  });

  it("フリー: 上限到達で allowed=false", async () => {
    const supabase = makeSupabase({
      addons: [],
      intakeCount: INTAKE_FREE_MONTHLY_LIMIT,
    });
    const s = await checkIntakeLimit(supabase, "user-1", now);
    expect(s.allowed).toBe(false);
  });

  it("アドオン契約者: limit が ADDON 値に上がる", async () => {
    const supabase = makeSupabase({
      addons: [
        {
          addon_key: "meeting_recording_auto",
          status: "active",
          current_period_end: null,
        },
      ],
      intakeCount: INTAKE_FREE_MONTHLY_LIMIT + 5,
    });
    const s = await checkIntakeLimit(supabase, "user-1", now);
    expect(s.allowed).toBe(true);
    expect(s.limit).toBe(INTAKE_ADDON_MONTHLY_LIMIT);
    expect(s.addon).toBe(true);
  });

  it("resetsAt は翌月初(UTC)", async () => {
    const supabase = makeSupabase({ addons: [], intakeCount: 0 });
    const s = await checkIntakeLimit(supabase, "user-1", now);
    expect(s.resetsAt).toBe("2026-07-01T00:00:00.000Z");
  });
});
