import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetFieldEncryptionCacheForTests } from "@/lib/crypto/field-encryption";

/**
 * queries.ts のテスト(Step 3c: blob-only)
 *
 * 旧個別 PII カラムは DB から DROP 済み。書き込みは encrypted_pii のみ、
 * 読み取りも encrypted_pii からの復号のみ。encrypted_pii が NULL/空の行は
 * fail-closed で throw することを検証する。
 */

type StubState = {
  insertedRow: Record<string, unknown> | null;
  updatedValues: Record<string, unknown> | null;
  selectedRow: Record<string, unknown> | null;
  selectedRows: Record<string, unknown>[] | null;
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
    order: vi.fn(() => Promise.resolve({ data: state.selectedRows ?? [], error: null })),
    single: vi.fn(() =>
      Promise.resolve({ data: state.selectedRow ?? { id: "generated-id" }, error: null }),
    ),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.selectedRow, error: null })),
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
    selectedRows: null,
  };
  fromMock.mockClear();
});

import type { SaveResumeRequest } from "./types";

const SAMPLE_INPUT: SaveResumeRequest = {
  title: "○○社向け履歴書",
  name: "山田 太郎",
  name_kana: "やまだ たろう",
  birth_date: "1995-04-12",
  gender: "male",
  postal_code: "100-0001",
  address: "東京都千代田区千代田1-1",
  address_kana: "とうきょうとちよだくちよだ",
  phone: "090-1234-5678",
  email: "taro@example.com",
  contact_address: "東京都港区赤坂1-1-1",
  contact_address_kana: "とうきょうとみなとくあかさか",
  contact_phone: "03-1234-5678",
  document_date: "2026-06-01",
  education_history: [{ year: 2017, month: 3, description: "○○高校 卒業" }],
  licenses: [{ year: 2018, month: 6, name: "普通自動車第一種運転免許" }],
  motivation_note: "御社に強く共感し志望いたしました。",
  personal_requests: "リモート希望。",
};

// ============================================
// 書き込み(blob-only)
// ============================================
describe("queries.ts - blob-only 書き込み", () => {
  it("createResume は encrypted_pii と [KEEP] 項目だけを書く(平文 PII を書かない)", async () => {
    const { createResume } = await import("./queries");
    const { decryptField } = await import("@/lib/crypto/field-encryption");
    const { deserializeResumePii } = await import("./pii-fields");

    await createResume("user-1", SAMPLE_INPUT);

    const row = state.insertedRow;
    expect(row).not.toBeNull();

    // [KEEP] 項目だけが平文として書き込まれる
    expect(row?.user_id).toBe("user-1");
    expect(row?.title).toBe(SAMPLE_INPUT.title);
    expect(row?.document_date).toBe("2026-06-01");

    // encrypted_pii は v1: プレフィックス付き
    expect(typeof row?.encrypted_pii).toBe("string");
    expect(row?.encrypted_pii as string).toMatch(/^v1:/);

    // 旧個別 PII カラムは absent(undefined)。
    // ここに値があると DROP 後の DB に書き込み失敗するため critical。
    expect(row).not.toHaveProperty("name");
    expect(row).not.toHaveProperty("name_kana");
    expect(row).not.toHaveProperty("birth_date");
    expect(row).not.toHaveProperty("gender");
    expect(row).not.toHaveProperty("postal_code");
    expect(row).not.toHaveProperty("address");
    expect(row).not.toHaveProperty("address_kana");
    expect(row).not.toHaveProperty("phone");
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("contact_address");
    expect(row).not.toHaveProperty("contact_address_kana");
    expect(row).not.toHaveProperty("contact_phone");
    expect(row).not.toHaveProperty("photo_url");
    expect(row).not.toHaveProperty("education_history");
    expect(row).not.toHaveProperty("licenses");
    expect(row).not.toHaveProperty("motivation_note");
    expect(row).not.toHaveProperty("personal_requests");

    // 復号した PII が SAMPLE_INPUT と一致する
    const decrypted = await decryptField(row?.encrypted_pii as string);
    const pii = deserializeResumePii(decrypted as string);
    expect(pii.name).toBe("山田 太郎");
    expect(pii.email).toBe("taro@example.com");
    expect(pii.birth_date).toBe("1995-04-12");
    expect(pii.education_history).toEqual(SAMPLE_INPUT.education_history);
    expect(pii.licenses).toEqual(SAMPLE_INPUT.licenses);
  });

  it("updateResume も encrypted_pii と [KEEP] 項目だけを書く", async () => {
    const { updateResume } = await import("./queries");

    await updateResume("resume-1", "user-1", SAMPLE_INPUT);

    const updates = state.updatedValues;
    expect(updates).not.toBeNull();
    expect(updates?.title).toBe(SAMPLE_INPUT.title);
    expect(updates?.document_date).toBe("2026-06-01");
    expect(typeof updates?.encrypted_pii).toBe("string");
    expect(updates?.encrypted_pii as string).toMatch(/^v1:/);
    expect(typeof updates?.updated_at).toBe("string");

    // 旧個別 PII カラムは含めない
    expect(updates).not.toHaveProperty("name");
    expect(updates).not.toHaveProperty("phone");
    expect(updates).not.toHaveProperty("education_history");
  });

  it("空文字の [KEEP] 項目(document_date)は null に正規化される", async () => {
    const { createResume } = await import("./queries");

    await createResume("user-1", { ...SAMPLE_INPUT, document_date: "  " });
    expect(state.insertedRow?.document_date).toBeNull();
  });
});

// ============================================
// 読み取り(blob からのみ)
// ============================================
describe("queries.ts - blob-only 読み取り", () => {
  it("encrypted_pii だけがある行を正しく復元できる", async () => {
    const { encryptField } = await import("@/lib/crypto/field-encryption");
    const { serializeResumePii, pickResumePii } = await import("./pii-fields");
    const { getResume } = await import("./queries");

    const pii = pickResumePii({
      name: "blob 太郎",
      email: "blob@example.com",
      birth_date: "1995-05-05",
      gender: "female",
      education_history: [{ year: 2020, month: 3, description: "卒業" }],
      licenses: [],
    });
    const encryptedPii = await encryptField(serializeResumePii(pii));

    state.selectedRow = {
      id: "r-1",
      user_id: "u-1",
      title: "履歴書",
      document_date: "2026-06-01",
      encrypted_pii: encryptedPii,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T01:00:00Z",
    };

    const resume = await getResume("r-1", "u-1");
    expect(resume).not.toBeNull();
    expect(resume?.name).toBe("blob 太郎");
    expect(resume?.email).toBe("blob@example.com");
    expect(resume?.birthDate).toBe("1995-05-05");
    expect(resume?.gender).toBe("female");
    expect(resume?.educationHistory).toEqual([{ year: 2020, month: 3, description: "卒業" }]);
    expect(resume?.documentDate).toBe("2026-06-01");
  });

  it("encrypted_pii が NULL の行は fail-closed で throw する(行 ID のみ、PII は出さない)", async () => {
    const { getResume } = await import("./queries");

    state.selectedRow = {
      id: "broken-1",
      user_id: "u-1",
      title: "壊れた行",
      document_date: null,
      encrypted_pii: null, // ← 想定に反して NULL
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };

    await expect(getResume("broken-1", "u-1")).rejects.toThrow(/broken-1/);
  });

  it("encrypted_pii が空文字の行も throw する", async () => {
    const { getResume } = await import("./queries");

    state.selectedRow = {
      id: "broken-2",
      user_id: "u-1",
      title: "空文字",
      document_date: null,
      encrypted_pii: "",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };

    await expect(getResume("broken-2", "u-1")).rejects.toThrow(/broken-2/);
  });

  it("下流に返る Resume オブジェクトの形(キー一覧)は現行と完全に同一", async () => {
    const { encryptField } = await import("@/lib/crypto/field-encryption");
    const { serializeResumePii, pickResumePii } = await import("./pii-fields");
    const { getResume } = await import("./queries");

    const encryptedPii = await encryptField(serializeResumePii(pickResumePii({})));

    state.selectedRow = {
      id: "r-3",
      user_id: "u-1",
      title: "形状チェック",
      document_date: null,
      encrypted_pii: encryptedPii,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };

    const resume = await getResume("r-3", "u-1");

    // Resume 型のキー一覧(camelCase)。Step 3a と完全に同じ。
    expect(Object.keys(resume ?? {}).sort()).toEqual(
      [
        "address",
        "addressKana",
        "birthDate",
        "contactAddress",
        "contactAddressKana",
        "contactPhone",
        "createdAt",
        "documentDate",
        "educationHistory",
        "email",
        "gender",
        "id",
        "licenses",
        "motivationNote",
        "name",
        "nameKana",
        "personalRequests",
        "phone",
        "photoUrl",
        "postalCode",
        "title",
        "updatedAt",
        "userId",
      ].sort(),
    );
  });

  it("listResumes も blob からのみ復元する", async () => {
    const { encryptField } = await import("@/lib/crypto/field-encryption");
    const { serializeResumePii, pickResumePii } = await import("./pii-fields");
    const { listResumes } = await import("./queries");

    const encryptedPii = await encryptField(
      serializeResumePii(
        pickResumePii({
          name: "リスト ユーザ",
          email: "list@example.com",
          education_history: [],
          licenses: [],
        }),
      ),
    );

    state.selectedRows = [
      {
        id: "r-A",
        user_id: "u-1",
        title: "履歴書A",
        document_date: null,
        encrypted_pii: encryptedPii,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ];

    const resumes = await listResumes("u-1");
    expect(resumes).toHaveLength(1);
    expect(resumes[0].name).toBe("リスト ユーザ");
    expect(resumes[0].email).toBe("list@example.com");
  });

  it("listResumes は NULL 行があれば throw する(fail-closed)", async () => {
    const { listResumes } = await import("./queries");

    state.selectedRows = [
      {
        id: "broken-3",
        user_id: "u-1",
        title: "壊れた",
        document_date: null,
        encrypted_pii: null,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ];

    await expect(listResumes("u-1")).rejects.toThrow(/broken-3/);
  });
});
