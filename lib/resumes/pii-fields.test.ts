import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptField,
  decryptField,
  __resetFieldEncryptionCacheForTests,
} from "@/lib/crypto/field-encryption";
import {
  pickResumePii,
  serializeResumePii,
  deserializeResumePii,
  RESUME_PII_FIELDS,
  type ResumePii,
} from "./pii-fields";

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

/**
 * 「全フィールドが入った PII」のサンプル。
 * 履歴書の現実的な内容を網羅(jsonb / 日付 / 自由記述まで)。
 */
const FULL_PII: ResumePii = {
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
  photo_url: "https://example.com/photo.png",
  education_history: [
    { year: 2014, month: 4, description: "○○高校 入学" },
    { year: 2017, month: 3, description: "○○高校 卒業" },
    { year: 2021, month: 4, description: "△△株式会社 入社" },
  ],
  licenses: [
    { year: 2018, month: 6, name: "普通自動車第一種運転免許" },
    { year: 2022, month: 11, name: "TOEIC 800 点" },
  ],
  motivation_note: "御社の事業に強く共感し志望いたしました。",
  personal_requests: "リモートワーク中心を希望します。",
};

describe("pii-fields - pure logic", () => {
  describe("RESUME_PII_FIELDS の網羅", () => {
    it("ResumePii のキーと RESUME_PII_FIELDS が一致する", () => {
      // 抜け漏れ防止:型レベルでも実行時でも揃っていることを確認
      const keys = new Set(Object.keys(FULL_PII));
      const fields = new Set<string>(RESUME_PII_FIELDS);
      expect(keys).toEqual(fields);
    });
  });

  describe("pickResumePii", () => {
    it("DB 行風オブジェクトから PII フィールドだけを抜き出す", () => {
      const row = {
        ...FULL_PII,
        // PII 対象外のキーを混ぜても無視される
        id: "abc",
        user_id: "uid",
        title: "履歴書",
        document_date: "2026-06-01",
        created_at: "2026-06-01T00:00:00Z",
      };
      const picked = pickResumePii(row);
      expect(picked).toEqual(FULL_PII);
      // PII 対象外は出てこない
      expect((picked as Record<string, unknown>).id).toBeUndefined();
      expect((picked as Record<string, unknown>).document_date).toBeUndefined();
    });

    it("文字列以外の型違いは null に倒される", () => {
      const picked = pickResumePii({
        name: 123,
        email: { obj: 1 },
        phone: null,
      });
      expect(picked.name).toBeNull();
      expect(picked.email).toBeNull();
      expect(picked.phone).toBeNull();
    });

    it("不正な gender は null に倒される", () => {
      expect(pickResumePii({ gender: "invalid" }).gender).toBeNull();
      expect(pickResumePii({ gender: "male" }).gender).toBe("male");
    });

    it("education_history / licenses はスキーマ違反を除外する", () => {
      const picked = pickResumePii({
        education_history: [
          { year: 2017, month: 3, description: "卒業" },
          { year: "bad", month: 3, description: "壊れた行" }, // 弾かれる
        ],
        licenses: [{ year: 2018, month: 6, name: "免許" }, "not-an-object"],
      });
      expect(picked.education_history).toHaveLength(1);
      expect(picked.licenses).toHaveLength(1);
    });
  });

  describe("serialize / deserialize 往復", () => {
    it("全フィールド入りの PII が JSON 往復で完全一致する", () => {
      const json = serializeResumePii(FULL_PII);
      expect(typeof json).toBe("string");
      const restored = deserializeResumePii(json);
      expect(restored).toEqual(FULL_PII);
    });

    it("null / 空配列だけの PII でも往復一致する", () => {
      const empty: ResumePii = {
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
      const json = serializeResumePii(empty);
      expect(deserializeResumePii(json)).toEqual(empty);
    });

    it("壊れた JSON でも例外を投げず空 PII を返す(画面を落とさない)", () => {
      const restored = deserializeResumePii("{not json");
      expect(restored.name).toBeNull();
      expect(restored.education_history).toEqual([]);
    });

    it("シリアライズの並びは RESUME_PII_FIELDS の順", () => {
      const json = serializeResumePii(FULL_PII);
      // JSON 文字列のキー順を検査(レビュー時の差分を安定させたい)
      const keys = Object.keys(JSON.parse(json));
      expect(keys).toEqual([...RESUME_PII_FIELDS]);
    });
  });

  describe("encrypt + decrypt 往復(field-encryption と組み合わせる)", () => {
    it("PII を暗号化→復号→deserialize で完全一致する", async () => {
      const json = serializeResumePii(FULL_PII);
      const encrypted = await encryptField(json);
      expect(encrypted).toMatch(/^v1:/);

      const decrypted = await decryptField(encrypted);
      expect(typeof decrypted).toBe("string");
      const restored = deserializeResumePii(decrypted as string);

      expect(restored).toEqual(FULL_PII);
    });

    it("同じ PII でも IV が違うので暗号文が毎回変わる", async () => {
      const json = serializeResumePii(FULL_PII);
      const a = await encryptField(json);
      const b = await encryptField(json);
      expect(a).not.toBe(b);
      // どちらを復号しても同じ PII に戻る
      expect(deserializeResumePii((await decryptField(a)) as string)).toEqual(FULL_PII);
      expect(deserializeResumePii((await decryptField(b)) as string)).toEqual(FULL_PII);
    });
  });
});
