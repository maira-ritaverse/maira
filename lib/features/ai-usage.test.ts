import { describe, expect, it, vi } from "vitest";

import {
  JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY,
  JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY,
  PHOTO_ENHANCE_ADDON_MONTHLY,
  PHOTO_ENHANCE_FREE_MONTHLY,
  checkAiUsageLimit,
  countAiUsageThisMonth,
} from "./ai-usage";

type MakeArgs = {
  addons: unknown[];
  usageCount: number;
  usageError?: unknown;
  /** 呼び出し元の account_type(detectCallerScope で使う)。既定は seeker。 */
  accountType?: "seeker" | "organization_member";
  /** organization_members レコードがあるか(account_type=organization_member の時のみ意味あり) */
  hasMembership?: boolean;
  /** 求職者の linked 組織が設定している quota(get_seeker_quota_for_kind RPC の返値) */
  seekerQuota?: number | null;
  /** 組織の カスタム quota(organization_ai_quotas.monthly_limit) */
  orgQuota?: number | null;
};

function makeSupabase(args: MakeArgs) {
  const accountType = args.accountType ?? "seeker";
  const hasMembership = args.hasMembership ?? false;
  const seekerQuota = args.seekerQuota === undefined ? null : args.seekerQuota;
  const orgQuota = args.orgQuota === undefined ? null : args.orgQuota;

  // subscription_addons: select(...).eq(user_id)
  const eqAddons = vi.fn().mockResolvedValue({ data: args.addons, error: null });
  const selectAddons = vi.fn().mockReturnValue({ eq: eqAddons });

  // ai_usage_events: select(...).eq(user_id).eq(kind).gte(created_at)
  const gte = vi.fn().mockResolvedValue({ count: args.usageCount, error: args.usageError ?? null });
  const eqKind = vi.fn().mockReturnValue({ gte });
  const eqUser = vi.fn().mockReturnValue({ eq: eqKind });
  const selectUsage = vi.fn().mockReturnValue({ eq: eqUser });

  // profiles: select("account_type").eq("id", userId).maybeSingle()
  const maybeSingleProfile = vi
    .fn()
    .mockResolvedValue({ data: { account_type: accountType }, error: null });
  const eqProfile = vi.fn().mockReturnValue({ maybeSingle: maybeSingleProfile });
  const selectProfile = vi.fn().mockReturnValue({ eq: eqProfile });

  // organization_members: select("id", { count: "exact", head: true }).eq("user_id", userId)
  const eqMembership = vi.fn().mockResolvedValue({ count: hasMembership ? 1 : 0, error: null });
  const selectMembership = vi.fn().mockReturnValue({ eq: eqMembership });

  // organization_ai_quotas: select("monthly_limit").eq("kind", kind).maybeSingle()
  const maybeSingleOrgQuota = vi.fn().mockResolvedValue({
    data: orgQuota !== null ? { monthly_limit: orgQuota } : null,
    error: null,
  });
  const eqOrgQuota = vi.fn().mockReturnValue({ maybeSingle: maybeSingleOrgQuota });
  const selectOrgQuota = vi.fn().mockReturnValue({ eq: eqOrgQuota });

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "subscription_addons") return { select: selectAddons };
    if (table === "ai_usage_events") return { select: selectUsage };
    if (table === "profiles") return { select: selectProfile };
    if (table === "organization_members") return { select: selectMembership };
    if (table === "organization_ai_quotas") return { select: selectOrgQuota };
    throw new Error(`unexpected table: ${table}`);
  });

  const rpc = vi.fn().mockImplementation((name: string) => {
    if (name === "get_seeker_quota_for_kind") {
      return Promise.resolve({ data: seekerQuota, error: null });
    }
    if (name === "count_org_ai_usage_this_month") {
      return Promise.resolve({ data: args.usageCount, error: null });
    }
    throw new Error(`unexpected rpc: ${name}`);
  });

  return { from, rpc } as never;
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

describe("checkAiUsageLimit: photo_enhance(seeker scope)", () => {
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

  it("組織カスタム上限(seekerQuota)が 既定値より 寛大なら そちらが 優先", async () => {
    const s = makeSupabase({
      addons: [],
      usageCount: 6, // 既定 5 件超え
      seekerQuota: 10,
    });
    const r = await checkAiUsageLimit(s, "u", "photo_enhance", now);
    expect(r.limit).toBe(10);
    expect(r.allowed).toBe(true);
  });

  it("組織カスタム上限が 0 なら 完全停止", async () => {
    const s = makeSupabase({ addons: [], usageCount: 0, seekerQuota: 0 });
    const r = await checkAiUsageLimit(s, "u", "photo_enhance", now);
    expect(r.limit).toBe(0);
    expect(r.allowed).toBe(false);
  });
});

describe("checkAiUsageLimit: job_recommendation_seeker(seeker scope)", () => {
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

describe("checkAiUsageLimit: scope mismatch は 403 相当(allowed=false)", () => {
  it("seeker が agency_org kind を叩くと 拒否", async () => {
    const s = makeSupabase({ addons: [], usageCount: 0, accountType: "seeker" });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_agency", now);
    expect(r.allowed).toBe(false);
    expect(r.limit).toBe(0);
    expect(r.callerScope).toBe("seeker");
  });

  it("agency member が seeker_per_user kind を叩くと 拒否", async () => {
    const s = makeSupabase({
      addons: [],
      usageCount: 0,
      accountType: "organization_member",
      hasMembership: true,
    });
    const r = await checkAiUsageLimit(s, "u", "photo_enhance", now);
    expect(r.allowed).toBe(false);
    expect(r.callerScope).toBe("agency_member");
  });
});

describe("checkAiUsageLimit: agency_org scope", () => {
  it("org member: 組織横断 利用数を 既定値と比較", async () => {
    const s = makeSupabase({
      addons: [],
      usageCount: 30, // 組織合算 30 件
      accountType: "organization_member",
      hasMembership: true,
    });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_agency", now);
    // 既定値 50 件で 比較 → 30 < 50 → allowed
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(50);
    expect(r.callerScope).toBe("agency_member");
  });

  it("組織カスタム上限が 既定より厳しい設定でも反映される", async () => {
    const s = makeSupabase({
      addons: [],
      usageCount: 20,
      accountType: "organization_member",
      hasMembership: true,
      orgQuota: 10, // 厳しめ
    });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_agency", now);
    expect(r.limit).toBe(10);
    expect(r.allowed).toBe(false);
  });
});
