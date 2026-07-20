import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  JOB_RECOMMENDATION_SEEKER_ADDON_MONTHLY,
  JOB_RECOMMENDATION_SEEKER_FREE_MONTHLY,
  PHOTO_ENHANCE_ADDON_MONTHLY,
  PHOTO_ENHANCE_FREE_MONTHLY,
  checkAiUsageLimit,
  countAiUsageThisMonth,
  getAiKindWeight,
  recordAiUsage,
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
  /** Maira admin の 強制 quota(get_platform_ai_quota_for_caller RPC の返値) */
  platformQuota?: number | null;
  /** Maira admin の 月次 総量上限 (get_platform_ai_total_quota_for_caller) */
  platformTotalQuota?: number | null;
  /** 当月 の 組織 agency_org 総使用回数 (count_org_ai_usage_total_this_month) */
  orgTotalUsage?: number;
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

  // organization_members: select("id", { count: "exact", head: true }).eq("user_id", userId).is("removed_at", null)
  // soft delete された メンバー は count 対象外 に する ため .is() が 末尾 に 付く。
  const isMembership = vi.fn().mockResolvedValue({ count: hasMembership ? 1 : 0, error: null });
  const eqMembership = vi.fn().mockReturnValue({ is: isMembership });
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
    if (name === "get_platform_ai_quota_for_caller") {
      // テスト では platform 強制 上限 は 未設定 と 仮定 (null = 未設定)
      // ※ 個別ケース で 上限あり を 検証 したい 場合は args.platformQuota を 渡す
      return Promise.resolve({ data: args.platformQuota ?? null, error: null });
    }
    if (name === "get_platform_ai_total_quota_for_caller") {
      // 既定 500 を 既存テスト に 影響させない ため、明示指定 が なければ
      // 十分 大きな 数 (Infinity 相当) を 返して 総量チェック を 通過させる
      return Promise.resolve({
        data: args.platformTotalQuota ?? Number.MAX_SAFE_INTEGER,
        error: null,
      });
    }
    if (name === "count_org_ai_usage_total_this_month") {
      return Promise.resolve({ data: args.orgTotalUsage ?? 0, error: null });
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

  it("Maira admin の 強制上限 (platformQuota) が org / 既定値 より 優先 される", async () => {
    // platform=3, org=50, 既定=100 でも platform 3 が 採用される
    const s = makeSupabase({
      addons: [],
      usageCount: 0,
      accountType: "organization_member",
      hasMembership: true,
      platformQuota: 3,
      orgQuota: 50,
    });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_agency", now);
    expect(r.limit).toBe(3);
    expect(r.allowed).toBe(true);
  });

  it("Maira admin の 強制上限 が 0 (完全停止) なら allowed=false", async () => {
    const s = makeSupabase({
      addons: [],
      usageCount: 0,
      accountType: "organization_member",
      hasMembership: true,
      platformQuota: 0,
      orgQuota: 100,
    });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_agency", now);
    expect(r.limit).toBe(0);
    expect(r.allowed).toBe(false);
  });

  it("総量上限 500 を 超えていれば 個別 kind に 余裕が あっても 拒否される", async () => {
    const s = makeSupabase({
      addons: [],
      usageCount: 10, // 個別 kind は まだ 余裕
      accountType: "organization_member",
      hasMembership: true,
      platformTotalQuota: 500,
      orgTotalUsage: 500, // 既に 総量 上限 到達
    });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_agency", now);
    expect(r.allowed).toBe(false);
    expect(r.limit).toBe(0); // 総量 拒否時は limit=0 を 報告
  });

  it("総量上限 に 余裕 + 個別 kind にも 余裕 なら allowed", async () => {
    const s = makeSupabase({
      addons: [],
      usageCount: 10,
      accountType: "organization_member",
      hasMembership: true,
      platformTotalQuota: 500,
      orgTotalUsage: 100, // 総量 余裕あり
    });
    const r = await checkAiUsageLimit(s, "u", "job_recommendation_agency", now);
    expect(r.allowed).toBe(true);
  });
});

// ────────────────────────────────────────────
// getAiKindWeight + recordAiUsage の 重み付け 挙動 (Solo プラン Phase 6)
// ────────────────────────────────────────────

// (import は ファイル 冒頭 に 集約 済み: getAiKindWeight / recordAiUsage を 追加)

describe("getAiKindWeight", () => {
  it("軽量 kind は 1 (photo_enhance)", () => {
    expect(getAiKindWeight("photo_enhance")).toBe(1);
  });

  it("軽量 kind は 1 (job_recommendation_agency)", () => {
    expect(getAiKindWeight("job_recommendation_agency")).toBe(1);
  });

  it("軽量 kind は 1 (agency_client_summary)", () => {
    expect(getAiKindWeight("agency_client_summary")).toBe(1);
  });

  it("Vision kind は 2 (job_extract_from_document)", () => {
    expect(getAiKindWeight("job_extract_from_document")).toBe(2);
  });

  it("Vision kind は 2 (agency_client_document_extract)", () => {
    expect(getAiKindWeight("agency_client_document_extract")).toBe(2);
  });

  it("長文生成 kind は 2 (recommendation_letter_draft)", () => {
    expect(getAiKindWeight("recommendation_letter_draft")).toBe(2);
  });

  it("MA 生成 kind は 2 (agency_ma_flow_generation)", () => {
    expect(getAiKindWeight("agency_ma_flow_generation")).toBe(2);
  });

  it("録音 kind は 1 (別 個 別ロジック で 90 分 超過時 に 2 件 換算)", () => {
    expect(getAiKindWeight("agency_recording_processed")).toBe(1);
  });
});

describe("recordAiUsage: 重み付け", () => {
  function makeMockClient() {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    return { supabase: { from } as unknown as SupabaseClient, insert, from };
  }

  it("weight=1 kind は 単一 行 で INSERT (従来 挙動 と 同じ、 metadata に unit_index を 足さない)", async () => {
    const { supabase, insert, from } = makeMockClient();
    await recordAiUsage(supabase, "user-1", "photo_enhance", { resumeId: "r1" });
    expect(from).toHaveBeenCalledWith("ai_usage_events");
    expect(insert).toHaveBeenCalledWith([
      { user_id: "user-1", kind: "photo_enhance", metadata: { resumeId: "r1" } },
    ]);
  });

  it("weight=1 で metadata 未指定 の 場合 は metadata=null で INSERT", async () => {
    const { supabase, insert } = makeMockClient();
    await recordAiUsage(supabase, "user-1", "job_recommendation_agency");
    expect(insert).toHaveBeenCalledWith([
      { user_id: "user-1", kind: "job_recommendation_agency", metadata: null },
    ]);
  });

  it("weight=2 kind は 2 行 で INSERT (metadata に weight_unit_index/total を 添える)", async () => {
    const { supabase, insert } = makeMockClient();
    await recordAiUsage(supabase, "user-1", "job_extract_from_document", { docId: "d1" });
    expect(insert).toHaveBeenCalledWith([
      {
        user_id: "user-1",
        kind: "job_extract_from_document",
        metadata: { docId: "d1", weight_unit_index: 1, weight_unit_total: 2 },
      },
      {
        user_id: "user-1",
        kind: "job_extract_from_document",
        metadata: { docId: "d1", weight_unit_index: 2, weight_unit_total: 2 },
      },
    ]);
  });

  it("weight=2 で metadata 未指定 でも weight_unit_index/total は 記録 される", async () => {
    const { supabase, insert } = makeMockClient();
    await recordAiUsage(supabase, "user-1", "recommendation_letter_draft");
    expect(insert).toHaveBeenCalledWith([
      {
        user_id: "user-1",
        kind: "recommendation_letter_draft",
        metadata: { weight_unit_index: 1, weight_unit_total: 2 },
      },
      {
        user_id: "user-1",
        kind: "recommendation_letter_draft",
        metadata: { weight_unit_index: 2, weight_unit_total: 2 },
      },
    ]);
  });

  it("INSERT が エラー を 返して も throw しない (warn ログ のみ)", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db down" } });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from } as unknown as SupabaseClient;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordAiUsage(supabase, "user-1", "job_extract_from_document"),
    ).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
