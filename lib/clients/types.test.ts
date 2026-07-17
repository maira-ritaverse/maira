import { describe, it, expect } from "vitest";
import {
  clientCloseReasonLabels,
  clientLinkStatusLabels,
  clientStatusLabels,
  createClientRequestSchema,
  updateClientRequestSchema,
  type ClientCloseReason,
  type ClientLinkStatus,
  type ClientStatus,
} from "./types";

/**
 * クライアント関連の定数と zod スキーマのテスト。
 *
 * 3 つの labels は「DB の check 制約と画面表示の単一情報源」。union から要素が
 * 漏れると画面で undefined 表示やクラッシュが起きる。zod スキーマは API
 * 境界の検証なので、許容/不許容の挙動を明示テストして無自覚な緩和を防ぐ。
 */

const ALL_STATUSES: ClientStatus[] = [
  "initial_meeting",
  "job_matching",
  "in_screening",
  "offer",
  "completed",
  "declined",
];

const ALL_LINK_STATUSES: ClientLinkStatus[] = [
  "unlinked",
  "invited",
  "linked",
  "revoke_requested",
  "revoked",
];

const ALL_CLOSE_REASONS: ClientCloseReason[] = [
  "declined",
  "self_arranged",
  "other_agency",
  "unresponsive",
  "ineligible",
  "completed",
  "other",
];

describe("clientStatusLabels", () => {
  it("全 ClientStatus にラベルが定義されている", () => {
    for (const s of ALL_STATUSES) {
      expect(clientStatusLabels[s], `${s} のラベルが無い`).toBeTruthy();
    }
  });

  it("ラベルは全部非空", () => {
    for (const s of ALL_STATUSES) {
      expect(clientStatusLabels[s].length).toBeGreaterThan(0);
    }
  });

  it("union と labels のキー数が一致(余計なキーが混入していない)", () => {
    expect(Object.keys(clientStatusLabels).sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe("clientLinkStatusLabels", () => {
  it("全 ClientLinkStatus にラベルが定義されている", () => {
    for (const s of ALL_LINK_STATUSES) {
      expect(clientLinkStatusLabels[s]).toBeTruthy();
    }
  });

  it("union と labels のキー数が一致", () => {
    expect(Object.keys(clientLinkStatusLabels).sort()).toEqual([...ALL_LINK_STATUSES].sort());
  });
});

describe("clientCloseReasonLabels", () => {
  it("全 ClientCloseReason にラベルが定義されている", () => {
    for (const r of ALL_CLOSE_REASONS) {
      expect(clientCloseReasonLabels[r]).toBeTruthy();
    }
  });

  it("union と labels のキー数が一致(check 制約と整合する)", () => {
    // DB の close_reason CHECK 制約と一致する必要がある。
    // ここを増減したらマイグレーションも更新すること。
    expect(Object.keys(clientCloseReasonLabels).sort()).toEqual([...ALL_CLOSE_REASONS].sort());
  });
});

describe("createClientRequestSchema", () => {
  it("最小構成(name + email)で通る、status は default 'initial_meeting'", () => {
    const r = createClientRequestSchema.safeParse({
      name: "田中太郎",
      email: "tanaka@example.com",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("initial_meeting");
      // email_distribution_enabled は default true(MA 配信抑制フラグ)
      expect(r.data.email_distribution_enabled).toBe(true);
    }
  });

  it("name が空文字なら失敗", () => {
    const r = createClientRequestSchema.safeParse({ name: "", email: "a@b.co" });
    expect(r.success).toBe(false);
  });

  it("不正な email 形式は失敗(空文字ではない場合のみ検証がかかる)", () => {
    const r = createClientRequestSchema.safeParse({ name: "X", email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("email は省略可・空文字も可(LINE 由来の顧客等でメール未取得を許容)", () => {
    // 省略
    expect(createClientRequestSchema.safeParse({ name: "X" }).success).toBe(true);
    // 空文字
    expect(createClientRequestSchema.safeParse({ name: "X", email: "" }).success).toBe(true);
  });

  it("phone は省略可・空文字も可(任意項目)", () => {
    expect(
      createClientRequestSchema.safeParse({ name: "X", email: "a@b.co", phone: "" }).success,
    ).toBe(true);
    expect(
      createClientRequestSchema.safeParse({ name: "X", email: "a@b.co", phone: "0312345678" })
        .success,
    ).toBe(true);
  });

  it("entry_site は 100 文字超で失敗", () => {
    const r = createClientRequestSchema.safeParse({
      name: "X",
      email: "a@b.co",
      entry_site: "a".repeat(101),
    });
    expect(r.success).toBe(false);
  });

  it("email_distribution_enabled=false を明示できる", () => {
    const r = createClientRequestSchema.safeParse({
      name: "X",
      email: "a@b.co",
      email_distribution_enabled: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email_distribution_enabled).toBe(false);
  });

  it("status は ALL_STATUSES 以外を拒否(check 制約と一致)", () => {
    const r = createClientRequestSchema.safeParse({
      name: "X",
      email: "a@b.co",
      status: "in_progress", // 存在しない status
    });
    expect(r.success).toBe(false);
  });
});

describe("updateClientRequestSchema", () => {
  it("全フィールド省略可(部分更新)", () => {
    const r = updateClientRequestSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("close_reason は null を許容(失注理由のクリア)", () => {
    const r = updateClientRequestSchema.safeParse({ close_reason: null });
    expect(r.success).toBe(true);
  });

  it("close_reason は ALL_CLOSE_REASONS と空文字以外を拒否", () => {
    const r = updateClientRequestSchema.safeParse({ close_reason: "wrong_reason" });
    expect(r.success).toBe(false);
  });

  it("recommendation_comment は 5000 文字までは OK / 5001 で失敗", () => {
    expect(
      updateClientRequestSchema.safeParse({ recommendation_comment: "a".repeat(5000) }).success,
    ).toBe(true);
    expect(
      updateClientRequestSchema.safeParse({ recommendation_comment: "a".repeat(5001) }).success,
    ).toBe(false);
  });

  it("other_agency_status は 2000 文字制限", () => {
    expect(
      updateClientRequestSchema.safeParse({ other_agency_status: "a".repeat(2000) }).success,
    ).toBe(true);
    expect(
      updateClientRequestSchema.safeParse({ other_agency_status: "a".repeat(2001) }).success,
    ).toBe(false);
  });

  it("assigned_member_id は UUID 形式 / null / 省略を許容、他は拒否", () => {
    expect(
      updateClientRequestSchema.safeParse({
        assigned_member_id: "12345678-1234-1234-1234-123456789012",
      }).success,
    ).toBe(true);
    expect(updateClientRequestSchema.safeParse({ assigned_member_id: null }).success).toBe(true);
    expect(updateClientRequestSchema.safeParse({ assigned_member_id: "not-uuid" }).success).toBe(
      false,
    );
  });
});
