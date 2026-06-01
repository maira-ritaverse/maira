import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetFieldEncryptionCacheForTests } from "@/lib/crypto/field-encryption";

/**
 * queries.ts のテスト
 *
 * Supabase クライアントを最小限のスタブで差し替える。
 * 目的は「lib/resumes/queries.ts が dual-write し、読み取り時に blob を
 * 優先する」を実際の SQL ではなくロジックレベルで検証すること。
 */

// ============================================
// Supabase スタブ
//
// supabase.from("resumes") の戻りオブジェクトを 1 つのスタブで完結させる。
// insert / update / select / eq / order / single / maybeSingle / delete を
// 全部チェーン可能にする。
// ============================================
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

// ============================================
// セットアップ
// ============================================

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

// ============================================
// テスト用の標準入力
// ============================================
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
// 書き込み(dual-write)テスト
// ============================================
describe("queries.ts - dual-write 書き込み", () => {
  it("createResume は encrypted_pii と個別 PII カラムの両方を書く", async () => {
    const { createResume } = await import("./queries");
    const { decryptField } = await import("@/lib/crypto/field-encryption");
    const { deserializeResumePii } = await import("./pii-fields");

    await createResume("user-1", SAMPLE_INPUT);

    const row = state.insertedRow;
    expect(row).not.toBeNull();
    expect(row).toBeTypeOf("object");

    // user_id とタイトルが書かれている
    expect(row?.user_id).toBe("user-1");
    expect(row?.title).toBe(SAMPLE_INPUT.title);

    // 個別 PII カラムにも従来どおり平文が書かれている(dual-write)
    expect(row?.name).toBe("山田 太郎");
    expect(row?.email).toBe("taro@example.com");
    expect(row?.birth_date).toBe("1995-04-12");
    expect(row?.gender).toBe("male");
    expect(row?.education_history).toEqual(SAMPLE_INPUT.education_history);
    expect(row?.licenses).toEqual(SAMPLE_INPUT.licenses);
    // [KEEP] 項目
    expect(row?.document_date).toBe("2026-06-01");

    // encrypted_pii は v1: プレフィックス付きで埋まっている
    expect(typeof row?.encrypted_pii).toBe("string");
    expect(row?.encrypted_pii as string).toMatch(/^v1:/);

    // 復号した内容も個別カラムと一致している
    const decrypted = await decryptField(row?.encrypted_pii as string);
    const pii = deserializeResumePii(decrypted as string);
    expect(pii.name).toBe("山田 太郎");
    expect(pii.email).toBe("taro@example.com");
    expect(pii.birth_date).toBe("1995-04-12");
    expect(pii.education_history).toEqual(SAMPLE_INPUT.education_history);
    expect(pii.licenses).toEqual(SAMPLE_INPUT.licenses);
  });

  it("updateResume も dual-write する(encrypted_pii + 個別カラム)", async () => {
    const { updateResume } = await import("./queries");

    await updateResume("resume-1", "user-1", SAMPLE_INPUT);

    const updates = state.updatedValues;
    expect(updates).not.toBeNull();
    expect(updates?.name).toBe("山田 太郎");
    expect(updates?.phone).toBe("090-1234-5678");
    expect(typeof updates?.encrypted_pii).toBe("string");
    expect(updates?.encrypted_pii as string).toMatch(/^v1:/);
    // updated_at は ISO 文字列で上書きされている
    expect(typeof updates?.updated_at).toBe("string");
  });

  it("空文字の項目は null に正規化されてから dual-write される", async () => {
    const { createResume } = await import("./queries");
    const { decryptField } = await import("@/lib/crypto/field-encryption");
    const { deserializeResumePii } = await import("./pii-fields");

    const sparse: SaveResumeRequest = {
      title: "ほぼ空の履歴書",
      name: "",
      email: "",
      education_history: [],
      licenses: [],
    };

    await createResume("user-1", sparse);

    const row = state.insertedRow;
    expect(row?.name).toBeNull();
    expect(row?.email).toBeNull();
    // 空でも encrypted_pii は埋める(Step 3b の判定をシンプルに保つため)
    expect(typeof row?.encrypted_pii).toBe("string");
    const pii = deserializeResumePii((await decryptField(row?.encrypted_pii as string)) as string);
    expect(pii.name).toBeNull();
    expect(pii.email).toBeNull();
    expect(pii.education_history).toEqual([]);
  });
});

// ============================================
// 読み取り(blob 優先 + フォールバック)テスト
// ============================================
describe("queries.ts - 読み取り境界", () => {
  it("encrypted_pii ありの行は blob から復元する(個別カラムより blob が優先)", async () => {
    const { encryptField } = await import("@/lib/crypto/field-encryption");
    const { serializeResumePii, pickResumePii } = await import("./pii-fields");
    const { getResume } = await import("./queries");

    // 個別カラムには「古い値」、blob には「新しい値」を入れて、
    // 戻り値が必ず blob 由来になることを確認する。
    const blobPii = pickResumePii({
      name: "新しい名前",
      email: "new@example.com",
      birth_date: "2000-01-01",
      gender: "female",
      education_history: [{ year: 2020, month: 3, description: "新しい学校 卒業" }],
      licenses: [],
    });
    const encryptedPii = await encryptField(serializeResumePii(blobPii));

    state.selectedRow = {
      id: "r-1",
      user_id: "u-1",
      title: "履歴書",
      // 個別カラムは古い値
      name: "古い名前",
      name_kana: null,
      birth_date: "1990-01-01",
      gender: "male",
      postal_code: null,
      address: null,
      address_kana: null,
      phone: null,
      email: "old@example.com",
      contact_address: null,
      contact_address_kana: null,
      contact_phone: null,
      photo_url: null,
      education_history: [{ year: 1990, month: 1, description: "古い学校" }],
      licenses: [],
      motivation_note: null,
      personal_requests: null,
      document_date: "2026-06-01",
      // blob 優先で復号されることを検証
      encrypted_pii: encryptedPii,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T01:00:00Z",
    };

    const resume = await getResume("r-1", "u-1");

    expect(resume).not.toBeNull();
    expect(resume?.name).toBe("新しい名前");
    expect(resume?.email).toBe("new@example.com");
    expect(resume?.birthDate).toBe("2000-01-01");
    expect(resume?.gender).toBe("female");
    expect(resume?.educationHistory).toEqual([
      { year: 2020, month: 3, description: "新しい学校 卒業" },
    ]);
    // [KEEP] 項目は行から
    expect(resume?.documentDate).toBe("2026-06-01");
    expect(resume?.title).toBe("履歴書");
  });

  it("encrypted_pii が NULL の行は個別カラムから復元する(フォールバック)", async () => {
    const { getResume } = await import("./queries");

    state.selectedRow = {
      id: "r-2",
      user_id: "u-1",
      title: "古い履歴書",
      name: "未移行 太郎",
      name_kana: "みいこう たろう",
      birth_date: "1990-05-05",
      gender: "male",
      postal_code: "100-0000",
      address: "東京都",
      address_kana: "とうきょうと",
      phone: "090-0000-0000",
      email: "legacy@example.com",
      contact_address: null,
      contact_address_kana: null,
      contact_phone: null,
      photo_url: null,
      education_history: [{ year: 2010, month: 3, description: "卒業" }],
      licenses: [{ year: 2015, month: 4, name: "免許" }],
      motivation_note: "古い動機",
      personal_requests: null,
      document_date: null,
      encrypted_pii: null, // ← 移行前
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    };

    const resume = await getResume("r-2", "u-1");

    expect(resume).not.toBeNull();
    expect(resume?.name).toBe("未移行 太郎");
    expect(resume?.email).toBe("legacy@example.com");
    expect(resume?.birthDate).toBe("1990-05-05");
    expect(resume?.educationHistory).toEqual([{ year: 2010, month: 3, description: "卒業" }]);
    expect(resume?.licenses).toEqual([{ year: 2015, month: 4, name: "免許" }]);
    expect(resume?.motivationNote).toBe("古い動機");
  });

  it("下流に返る Resume オブジェクトの形(キー一覧)が現行と一致", async () => {
    const { getResume } = await import("./queries");

    state.selectedRow = {
      id: "r-3",
      user_id: "u-1",
      title: "形状チェック",
      name: null,
      name_kana: null,
      birth_date: null,
      gender: null,
      postal_code: null,
      address: null,
      address_kana: null,
      phone: null,
      email: null,
      contact_address: null,
      contact_address_kana: null,
      contact_phone: null,
      photo_url: null,
      education_history: [],
      licenses: [],
      motivation_note: null,
      personal_requests: null,
      document_date: null,
      encrypted_pii: null,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };

    const resume = await getResume("r-3", "u-1");

    // Resume 型のキー一覧(camelCase)を網羅的に検査する。
    // 増減があれば失敗するので、契約が崩れたら気づける。
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

  it("listResumes も blob 優先で復元する", async () => {
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
        name: "stale",
        name_kana: null,
        birth_date: null,
        gender: null,
        postal_code: null,
        address: null,
        address_kana: null,
        phone: null,
        email: "stale@example.com",
        contact_address: null,
        contact_address_kana: null,
        contact_phone: null,
        photo_url: null,
        education_history: [],
        licenses: [],
        motivation_note: null,
        personal_requests: null,
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
});
