import { describe, it, expect } from "vitest";
import {
  buildInvitationUrl,
  defaultInvitationExpiresAt,
  generateInvitationToken,
  isInvitationExpired,
} from "./invitations";
import type { OrganizationInvitation } from "./types";

/**
 * 組織招待の純関数テスト。
 *
 * generateInvitationToken は暗号学的に安全な乱数を base64url で返す契約。
 * Math.random() を使ってはいけない(セキュリティ事故)ので、ここのテストで
 * 「衝突しない」「URL safe 文字のみ」を担保。
 *
 * defaultInvitationExpiresAt / isInvitationExpired は now を引数で受け取る
 * 設計にしているのでテスト可能(Date.now() 直接呼ばないため決定的)。
 */

describe("generateInvitationToken", () => {
  it("非空の文字列を返す", () => {
    expect(generateInvitationToken().length).toBeGreaterThan(0);
  });

  it("base64url 文字(A-Z a-z 0-9 - _)のみで構成される", () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("base64url なので '+'/'/'/'=' は含まない", () => {
    const token = generateInvitationToken();
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
  });

  it("32 バイト → base64url で 43 文字", () => {
    // randomBytes(32) は 32 バイト → base64url で padding 無し 43 文字
    expect(generateInvitationToken()).toHaveLength(43);
  });

  it("呼び出すたびに異なるトークンを返す(衝突しないことの一端を検証)", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateInvitationToken());
    }
    expect(tokens.size).toBe(100);
  });
});

describe("defaultInvitationExpiresAt", () => {
  it("now から 7 日後の Date を返す", () => {
    const now = new Date("2026-06-14T00:00:00Z");
    const exp = defaultInvitationExpiresAt(now);
    expect(exp.toISOString()).toBe("2026-06-21T00:00:00.000Z");
  });

  it("now を変えると返り値も連動", () => {
    const a = defaultInvitationExpiresAt(new Date("2026-01-01T00:00:00Z"));
    const b = defaultInvitationExpiresAt(new Date("2026-02-01T00:00:00Z"));
    expect(a.getTime()).not.toBe(b.getTime());
  });

  it("差分は正確に 7 * 24 * 60 * 60 * 1000 ms", () => {
    const now = new Date("2026-06-14T12:34:56.789Z");
    const exp = defaultInvitationExpiresAt(now);
    expect(exp.getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("isInvitationExpired", () => {
  function inv(overrides: Partial<OrganizationInvitation> = {}): OrganizationInvitation {
    return {
      id: "i1",
      organizationId: "o1",
      email: "x@y.co",
      role: "advisor",
      token: "tok",
      status: "pending",
      invitedByMemberId: null,
      expiresAt: "2026-06-21T00:00:00Z",
      acceptedAt: null,
      createdAt: "2026-06-14T00:00:00Z",
      ...overrides,
    };
  }

  it("pending + expires_at が過去なら期限切れ", () => {
    expect(
      isInvitationExpired(inv({ expiresAt: "2026-06-13T00:00:00Z" }), new Date("2026-06-14")),
    ).toBe(true);
  });

  it("pending + expires_at が未来なら期限切れでない", () => {
    expect(
      isInvitationExpired(inv({ expiresAt: "2026-06-21T00:00:00Z" }), new Date("2026-06-14")),
    ).toBe(false);
  });

  it("accepted は expires_at が過去でも期限切れ判定しない(status 優先)", () => {
    expect(
      isInvitationExpired(
        inv({ status: "accepted", expiresAt: "2026-06-13T00:00:00Z" }),
        new Date("2026-06-14"),
      ),
    ).toBe(false);
  });

  it("revoked も同様に期限切れ判定しない", () => {
    expect(
      isInvitationExpired(
        inv({ status: "revoked", expiresAt: "2026-06-13T00:00:00Z" }),
        new Date("2026-06-14"),
      ),
    ).toBe(false);
  });

  it("expired status も(常に false を返す):「実質期限切れ」判定は pending だけが対象", () => {
    // この関数は「DB 上で pending のままだが時刻的に切れている」を検知する目的。
    // 既に DB が expired にマークしていれば、別途 status で判定する。
    expect(
      isInvitationExpired(
        inv({ status: "expired", expiresAt: "2026-06-13T00:00:00Z" }),
        new Date("2026-06-14"),
      ),
    ).toBe(false);
  });

  it("ちょうど同じ時刻は期限切れではない(< 比較)", () => {
    const sameTime = "2026-06-14T00:00:00Z";
    expect(isInvitationExpired(inv({ expiresAt: sameTime }), new Date(sameTime))).toBe(false);
  });
});

describe("buildInvitationUrl", () => {
  it("token を /invite/<token> として組み立てる", () => {
    expect(buildInvitationUrl("abc-123", "https://maira.jp")).toBe(
      "https://maira.jp/invite/abc-123",
    );
  });

  it("末尾スラッシュを吸収する", () => {
    expect(buildInvitationUrl("tok", "https://maira.jp/")).toBe("https://maira.jp/invite/tok");
    expect(buildInvitationUrl("tok", "https://maira.jp///")).toBe("https://maira.jp/invite/tok");
  });

  it("siteUrl がパス付きでも末尾スラッシュだけ削る", () => {
    expect(buildInvitationUrl("tok", "https://maira.jp/app/")).toBe(
      "https://maira.jp/app/invite/tok",
    );
  });
});
