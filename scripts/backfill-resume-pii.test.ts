import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptField,
  decryptField,
  __resetFieldEncryptionCacheForTests,
} from "@/lib/crypto/field-encryption";
import { pickResumePii, serializeResumePii, deserializeResumePii } from "@/lib/resumes/pii-fields";
import { compareRowToBlob, type ResumeRowForVerify } from "@/lib/resumes/verify-pii";

/**
 * scripts/backfill-resume-pii.ts の主要経路(row → backfill → verify)を
 * 1 つのテストファイルで通す。
 *
 * Supabase そのものは標準 SDK 呼び出しなので、ここでは I/O 層ではなく
 * 「個別 PII カラム(行)からスクリプトと同じ手順で blob を作り、
 *  復号して compareRowToBlob したときに差分 0 になるか」を確認する。
 */

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
});

// バックフィル対象として現実的な「個別カラムだけ持っている行」を 1 件作る
const LEGACY_ROW: ResumeRowForVerify = {
  id: "legacy-1",
  name: "山田 太郎",
  name_kana: "やまだ たろう",
  birth_date: "1995-04-12",
  gender: "male",
  postal_code: "100-0001",
  address: "東京都千代田区千代田1-1",
  address_kana: "とうきょうとちよだくちよだ",
  phone: "090-1234-5678",
  email: "taro@example.com",
  contact_address: null,
  contact_address_kana: null,
  contact_phone: null,
  photo_url: null,
  education_history: [
    { year: 2017, month: 3, description: "○○高校 卒業" },
    { year: 2021, month: 4, description: "△△株式会社 入社" },
  ],
  licenses: [{ year: 2018, month: 6, name: "普通自動車第一種運転免許" }],
  motivation_note: "御社の事業に強く共感し志望いたしました。",
  personal_requests: "リモート希望。",
};

/**
 * スクリプトのバックフィル 1 行ぶんと同じ処理。
 */
async function backfillRow(row: ResumeRowForVerify): Promise<string> {
  const pii = pickResumePii(row);
  const ciphertext = await encryptField(serializeResumePii(pii));
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw new Error("encrypt produced empty");
  }
  return ciphertext;
}

/**
 * スクリプトの検証 1 行ぶんと同じ処理。
 */
async function verifyRow(
  row: ResumeRowForVerify,
  ciphertext: string,
): Promise<ReturnType<typeof compareRowToBlob>> {
  const plaintext = await decryptField(ciphertext);
  if (typeof plaintext !== "string") throw new Error("decrypt returned non-string");
  const blob = deserializeResumePii(plaintext);
  return compareRowToBlob(row, blob);
}

describe("scripts/backfill-resume-pii(主要経路)", () => {
  it("blob NULL の行をバックフィル → 検証で差分 0", async () => {
    const ciphertext = await backfillRow(LEGACY_ROW);
    expect(ciphertext).toMatch(/^v1:/);
    const diffs = await verifyRow(LEGACY_ROW, ciphertext);
    expect(diffs).toEqual([]);
  });

  it("冪等性:二度暗号化しても暗号文は違うが、両方とも検証 OK", async () => {
    // スクリプトの SELECT は encrypted_pii IS NULL でフィルタするので
    // 「処理済み行を再処理しない」のは SQL レベルで保証される。
    // ここでは「もう一度暗号化しても整合性が保たれる」性質を確認する
    // (= 結果が安定して同じ意味になる、= 再実行で破壊しない)。
    const c1 = await backfillRow(LEGACY_ROW);
    const c2 = await backfillRow(LEGACY_ROW);
    expect(c1).not.toBe(c2); // IV ランダム性

    expect(await verifyRow(LEGACY_ROW, c1)).toEqual([]);
    expect(await verifyRow(LEGACY_ROW, c2)).toEqual([]);
  });

  it("故意に個別カラムと食い違う blob を持つ行は、検証で差分として検出される", async () => {
    // 行のメール = taro@example.com、blob のメール = evil@example.com に上書き
    const tampered = await encryptField(
      serializeResumePii(pickResumePii({ ...LEGACY_ROW, email: "evil@example.com" })),
    );
    const diffs = await verifyRow(LEGACY_ROW, tampered);
    expect(diffs.length).toBeGreaterThan(0);
    // email の差分が必ず含まれる
    expect(diffs).toEqual(expect.arrayContaining([{ field: "email", kind: "value_mismatch" }]));
  });

  it("空の行(全カラム null)でもバックフィル → 検証一致", async () => {
    const empty: ResumeRowForVerify = {
      id: "empty-1",
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
    };
    const ciphertext = await backfillRow(empty);
    expect(await verifyRow(empty, ciphertext)).toEqual([]);
  });

  it("birth_date が空文字や前後空白でも、blob 化 → 検証で差分 0(date↔ISO 正規化)", async () => {
    const sloppy: ResumeRowForVerify = {
      ...LEGACY_ROW,
      birth_date: "  1995-04-12  ",
    };
    const ciphertext = await backfillRow(sloppy);
    expect(await verifyRow(sloppy, ciphertext)).toEqual([]);
  });
});
