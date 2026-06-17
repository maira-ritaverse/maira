import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFieldEncryptionCacheForTests } from "@/lib/crypto/field-encryption";

/**
 * recommendation-letters/queries.ts のテスト
 *
 * 検証ポイント:
 *   1. body / headline が AES-256-GCM で暗号化されて DB に書かれる(平文を書かない)
 *   2. 復号後に元の平文が返ってくる(往復が壊れていない)
 *   3. version が「max+1」で採番される(履歴の単調増加)
 *   4. finalized 済の letter は update で 'already_finalized' エラーを返す
 *
 * Supabase クライアントは fluent API なのでチェイン全体をスタブする
 * (lib/resumes/queries.test.ts と同じ作法)。
 */

type StubState = {
  insertedRow: Record<string, unknown> | null;
  updatedValues: Record<string, unknown> | null;
  // single() / maybeSingle() で返す行
  selectedRow: Record<string, unknown> | null;
  // version 採番用の max(version) 取得時に返す行
  maxRow: { version: number } | null;
  // insert().select().single() で返す行(暗号化済 body/headline を組み立てる)
  generatedRow: Record<string, unknown> | null;
};

let state: StubState;

function makeChain() {
  const chain = {
    insert: vi.fn((row: Record<string, unknown>) => {
      state.insertedRow = row;
      return chain;
    }),
    update: vi.fn((values: Record<string, unknown>) => {
      state.updatedValues = values;
      return chain;
    }),
    delete: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => {
      // insert().select().single() のパス:generatedRow を返す
      if (state.insertedRow && state.generatedRow) {
        return Promise.resolve({ data: state.generatedRow, error: null });
      }
      return Promise.resolve({ data: state.selectedRow ?? { id: "generated-id" }, error: null });
    }),
    maybeSingle: vi.fn(() => {
      // max(version) 取得のチェインは selectedRow を介さず maxRow を返す
      if (state.maxRow !== null) {
        const row = state.maxRow;
        state.maxRow = null;
        return Promise.resolve({ data: row, error: null });
      }
      return Promise.resolve({ data: state.selectedRow, error: null });
    }),
  };
  return chain;
}

const fromMock = vi.fn(() => makeChain());

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

function generateTestKey(seed: number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (seed + i) % 256;
  return Buffer.from(bytes).toString("base64");
}

const KEY_V1 = generateTestKey(0);

beforeEach(() => {
  process.env.FIELD_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1 });
  process.env.FIELD_ENCRYPTION_CURRENT_VERSION = "v1";
  __resetFieldEncryptionCacheForTests();
  state = {
    insertedRow: null,
    updatedValues: null,
    selectedRow: null,
    maxRow: null,
    generatedRow: null,
  };
  fromMock.mockClear();
});

describe("recommendation-letters/queries - createLetter", () => {
  it("body / headline を暗号化して保存する(平文を保存しない)", async () => {
    const { createLetter } = await import("./queries");
    const { decryptField } = await import("@/lib/crypto/field-encryption");

    // 既存 letter なし → max+1 = 1
    state.maxRow = null;
    // insert().select().single() の戻り値:後で組み立てるので一旦 null
    state.generatedRow = {
      id: "letter-1",
      organization_id: "org-1",
      referral_id: "ref-1",
      version: 1,
      status: "draft",
      // ここは createLetter 内で暗号化されたものを後検証で見るので空文字でも OK
      encrypted_body: "placeholder",
      encrypted_headline: "placeholder",
      template_id: null,
      created_by_member_id: "member-1",
      finalized_at: null,
      created_at: "2026-06-17T00:00:00Z",
      updated_at: "2026-06-17T00:00:00Z",
    };

    const result = await createLetter({
      referralId: "ref-1",
      organizationId: "org-1",
      memberId: "member-1",
      headline: "山田太郎さんの推薦",
      body: "拝啓\n貴社ますますご清祥のことと存じます。",
      templateId: null,
    });

    if ("error" in result) throw new Error(`createLetter failed: ${result.error}`);

    // insert に平文が含まれていないこと
    expect(state.insertedRow).not.toBeNull();
    const insertedBody = state.insertedRow?.encrypted_body as string;
    const insertedHeadline = state.insertedRow?.encrypted_headline as string;
    expect(insertedBody).toMatch(/^v1:/);
    expect(insertedHeadline).toMatch(/^v1:/);
    expect(insertedBody).not.toContain("拝啓");
    expect(insertedHeadline).not.toContain("山田太郎");

    // 復号して元の平文に戻ること
    expect(await decryptField(insertedBody)).toBe("拝啓\n貴社ますますご清祥のことと存じます。");
    expect(await decryptField(insertedHeadline)).toBe("山田太郎さんの推薦");

    // 新規 letter の version は 1 から
    expect(state.insertedRow?.version).toBe(1);
  });

  it("既存 letter がある場合は version = max + 1 で採番する", async () => {
    const { createLetter } = await import("./queries");

    // max(version)=3 の状態 → 新規は version=4
    state.maxRow = { version: 3 };
    state.generatedRow = {
      id: "letter-4",
      organization_id: "org-1",
      referral_id: "ref-1",
      version: 4,
      status: "draft",
      encrypted_body: "x",
      encrypted_headline: "x",
      template_id: null,
      created_by_member_id: "member-1",
      finalized_at: null,
      created_at: "2026-06-17T00:00:00Z",
      updated_at: "2026-06-17T00:00:00Z",
    };

    const result = await createLetter({
      referralId: "ref-1",
      organizationId: "org-1",
      memberId: "member-1",
      headline: "v4 見出し",
      body: "v4 本文",
      templateId: null,
    });
    if ("error" in result) throw new Error(`createLetter failed: ${result.error}`);

    expect(state.insertedRow?.version).toBe(4);
  });

  it("status は常に 'draft' で開始する(finalized で作らない)", async () => {
    const { createLetter } = await import("./queries");

    state.maxRow = null;
    state.generatedRow = {
      id: "letter-1",
      organization_id: "org-1",
      referral_id: "ref-1",
      version: 1,
      status: "draft",
      encrypted_body: "x",
      encrypted_headline: "x",
      template_id: null,
      created_by_member_id: "member-1",
      finalized_at: null,
      created_at: "2026-06-17T00:00:00Z",
      updated_at: "2026-06-17T00:00:00Z",
    };

    await createLetter({
      referralId: "ref-1",
      organizationId: "org-1",
      memberId: "member-1",
      headline: "h",
      body: "b",
      templateId: null,
    });

    expect(state.insertedRow?.status).toBe("draft");
  });
});

describe("recommendation-letters/queries - updateLetter (finalized ガード)", () => {
  it("finalized 済の letter を update しようとすると 'already_finalized' エラー", async () => {
    const { updateLetter } = await import("./queries");

    state.selectedRow = {
      id: "letter-1",
      organization_id: "org-1",
      referral_id: "ref-1",
      version: 1,
      status: "finalized",
      encrypted_body: "x",
      encrypted_headline: "x",
      template_id: null,
      created_by_member_id: "member-1",
      finalized_at: "2026-06-16T10:00:00Z",
      created_at: "2026-06-15T00:00:00Z",
      updated_at: "2026-06-16T10:00:00Z",
    };

    const result = await updateLetter({
      letterId: "letter-1",
      organizationId: "org-1",
      body: "編集後",
    });

    if (!("error" in result)) throw new Error("update should have failed");
    expect(result.code).toBe("already_finalized");
    // update が呼ばれていないこと
    expect(state.updatedValues).toBeNull();
  });

  it("draft の letter は body を暗号化して更新できる", async () => {
    const { updateLetter } = await import("./queries");
    const { decryptField } = await import("@/lib/crypto/field-encryption");

    state.selectedRow = {
      id: "letter-1",
      organization_id: "org-1",
      referral_id: "ref-1",
      version: 1,
      status: "draft",
      encrypted_body: "x",
      encrypted_headline: "x",
      template_id: null,
      created_by_member_id: "member-1",
      finalized_at: null,
      created_at: "2026-06-15T00:00:00Z",
      updated_at: "2026-06-15T00:00:00Z",
    };

    // PATCH 後の単一行は selectedRow を流用(simple stub のため)
    const result = await updateLetter({
      letterId: "letter-1",
      organizationId: "org-1",
      body: "更新後の本文",
    });

    if ("error" in result) throw new Error(`updateLetter failed: ${result.error}`);

    expect(state.updatedValues).not.toBeNull();
    const enc = state.updatedValues?.encrypted_body as string;
    expect(enc).toMatch(/^v1:/);
    expect(await decryptField(enc)).toBe("更新後の本文");
  });

  it("status=finalized への遷移時に finalized_at が同時セットされる", async () => {
    const { updateLetter } = await import("./queries");

    state.selectedRow = {
      id: "letter-1",
      organization_id: "org-1",
      referral_id: "ref-1",
      version: 1,
      status: "draft",
      encrypted_body: "x",
      encrypted_headline: "x",
      template_id: null,
      created_by_member_id: "member-1",
      finalized_at: null,
      created_at: "2026-06-15T00:00:00Z",
      updated_at: "2026-06-15T00:00:00Z",
    };

    await updateLetter({
      letterId: "letter-1",
      organizationId: "org-1",
      status: "finalized",
    });

    expect(state.updatedValues?.status).toBe("finalized");
    expect(typeof state.updatedValues?.finalized_at).toBe("string");
  });
});
