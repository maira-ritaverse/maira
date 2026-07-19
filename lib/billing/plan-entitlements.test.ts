/**
 * plan-entitlements.ts の 単体テスト。
 *
 * tier ごと の 権限 が 意図 通り 変わる か 確認。 「Solo は 招待 不可」 等 の
 * 経済 / セキュリティ の 根幹 に 関わる 値 を リグレッション から 守る。
 */
import { describe, expect, it } from "vitest";

import { getPlanEntitlements } from "./plan-entitlements";

describe("getPlanEntitlements: Solo", () => {
  const solo = getPlanEntitlements("solo");

  it("seatCap は 1 (1 席 固定)", () => {
    expect(solo.seatCap).toBe(1);
  });

  it("aiMonthlyLimit は 100 (AI 総量 の 経済 保護)", () => {
    expect(solo.aiMonthlyLimit).toBe(100);
  });

  it("メンバー 招待 は 不可 (1 席 固定 の 物理 ガード)", () => {
    expect(solo.canInviteMembers).toBe(false);
  });

  it("CSV / MA / ATS / 詳細レポート は 全 て 不可", () => {
    expect(solo.canUseCsvImport).toBe(false);
    expect(solo.canUseCsvExport).toBe(false);
    expect(solo.canUseMaFlows).toBe(false);
    expect(solo.canUseAtsIntegrations).toBe(false);
    expect(solo.canUseDetailedReports).toBe(false);
    expect(solo.canUseAdvancedReports).toBe(false);
  });

  it("面談録音 は 0 (機能 使用 不可)", () => {
    expect(solo.recordingLimit).toBe(0);
  });

  it("photo enhance は 月 5 回", () => {
    expect(solo.photoEnhanceLimit).toBe(5);
  });

  it("サポート SLA は 48 時間", () => {
    expect(solo.supportSlaHours).toBe(48);
  });
});

describe("getPlanEntitlements: Solo Pro", () => {
  const soloPro = getPlanEntitlements("solo_pro");

  it("seatCap は 1 (Solo と 同じ、 1 席 固定)", () => {
    expect(soloPro.seatCap).toBe(1);
  });

  it("aiMonthlyLimit は 200 (Solo 100 + 100)", () => {
    expect(soloPro.aiMonthlyLimit).toBe(200);
  });

  it("メンバー 招待 は 不可 (Solo と 同じ)", () => {
    expect(soloPro.canInviteMembers).toBe(false);
  });

  it("CSV import / export は 使用 可 (Solo との 差別化 ポイント)", () => {
    expect(soloPro.canUseCsvImport).toBe(true);
    expect(soloPro.canUseCsvExport).toBe(true);
  });

  it("詳細 レポート (月次 PDF 等) は 使用 可", () => {
    expect(soloPro.canUseDetailedReports).toBe(true);
  });

  it("アドバイザー別 絞込 は 不可 (1 席 で は 意味 なし)", () => {
    expect(soloPro.canUseAdvancedReports).toBe(false);
  });

  it("MA / ATS は 不可 (Team 系 のみ)", () => {
    expect(soloPro.canUseMaFlows).toBe(false);
    expect(soloPro.canUseAtsIntegrations).toBe(false);
  });

  it("面談録音 は 月 5 回 (お試し)", () => {
    expect(soloPro.recordingLimit).toBe(5);
  });

  it("photo enhance は 月 10 回 (Solo は 5)", () => {
    expect(soloPro.photoEnhanceLimit).toBe(10);
  });

  it("サポート SLA は 24 時間 (Solo は 48)", () => {
    expect(soloPro.supportSlaHours).toBe(24);
  });
});

describe("getPlanEntitlements: Team Standard", () => {
  const standard = getPlanEntitlements("standard");

  it("seatCap は 3 (2-3 席)", () => {
    expect(standard.seatCap).toBe(3);
  });

  it("aiMonthlyLimit は 500 (Team 系 の 既定)", () => {
    expect(standard.aiMonthlyLimit).toBe(500);
  });

  it("メンバー 招待 は 可 (チーム プラン)", () => {
    expect(standard.canInviteMembers).toBe(true);
  });

  it("CSV / MA は 使用 可", () => {
    expect(standard.canUseCsvImport).toBe(true);
    expect(standard.canUseMaFlows).toBe(true);
  });

  it("アドバイザー別 絞込 は 可 (複数 席 の 恩恵)", () => {
    expect(standard.canUseAdvancedReports).toBe(true);
  });

  it("面談録音 は 0 (standard_rec / standard_premium で 解放)", () => {
    expect(standard.recordingLimit).toBe(0);
  });
});

describe("getPlanEntitlements: Team Standard + 録音 (standard_rec)", () => {
  const rec = getPlanEntitlements("standard_rec");

  it("面談録音 は 50 件 / 月", () => {
    expect(rec.recordingLimit).toBe(50);
  });

  it("他 は standard と 同等", () => {
    expect(rec.seatCap).toBe(3);
    expect(rec.aiMonthlyLimit).toBe(500);
    expect(rec.canInviteMembers).toBe(true);
  });
});

describe("getPlanEntitlements: Team Standard Pro (standard_pro)", () => {
  const pro = getPlanEntitlements("standard_pro");

  it("seatCap は 5 (4-5 席)", () => {
    expect(pro.seatCap).toBe(5);
  });

  it("aiMonthlyLimit は 1000 (Pro 上限)", () => {
    expect(pro.aiMonthlyLimit).toBe(1000);
  });

  it("サポート SLA は 12 時間 (最短)", () => {
    expect(pro.supportSlaHours).toBe(12);
  });

  it("面談録音 は 0 (standard_premium で 解放)", () => {
    expect(pro.recordingLimit).toBe(0);
  });
});

describe("getPlanEntitlements: Team Standard Premium", () => {
  const premium = getPlanEntitlements("standard_premium");

  it("seatCap は 10 (最大)", () => {
    expect(premium.seatCap).toBe(10);
  });

  it("aiMonthlyLimit は 1000 (Pro 相当)", () => {
    expect(premium.aiMonthlyLimit).toBe(1000);
  });

  it("面談録音 は 50 件 / 月 (Pro + 録音 の 全部 入り)", () => {
    expect(premium.recordingLimit).toBe(50);
  });

  it("サポート SLA は 12 時間 (Pro と 同等)", () => {
    expect(premium.supportSlaHours).toBe(12);
  });
});
