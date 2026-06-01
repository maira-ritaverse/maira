import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptField,
  decryptField,
  __resetFieldEncryptionCacheForTests,
} from "./field-encryption";

/**
 * テスト用の固定鍵。コミットしてよい(本番では絶対に使わない値)。
 *
 * Node の Buffer は Vitest が Node 上で動くため使ってよいが、本体コードでは
 * Edge ランタイム互換のため使っていないことに注意。
 */
function generateTestKey(seed: number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (seed + i) % 256;
  return Buffer.from(bytes).toString("base64");
}

const KEY_V1 = generateTestKey(0);
const KEY_V2 = generateTestKey(100);

function setEnv(keys: Record<string, string>, current: string): void {
  process.env.FIELD_ENCRYPTION_KEYS = JSON.stringify(keys);
  process.env.FIELD_ENCRYPTION_CURRENT_VERSION = current;
  __resetFieldEncryptionCacheForTests();
}

describe("field-encryption", () => {
  beforeEach(() => {
    setEnv({ v1: KEY_V1 }, "v1");
  });

  describe("encryptField / decryptField の往復", () => {
    it("ASCII 文字列が暗号化 → 復号で元に戻る", async () => {
      const original = "hello world";
      const encrypted = await encryptField(original);
      expect(encrypted).toMatch(/^v1:/);
      expect(encrypted).not.toBe(original);
      const decrypted = await decryptField(encrypted);
      expect(decrypted).toBe(original);
    });

    it("日本語(マルチバイト)文字列が暗号化 → 復号で元に戻る", async () => {
      const original = "山田 太郎 / 履歴書 PII テスト";
      const encrypted = await encryptField(original);
      const decrypted = await decryptField(encrypted);
      expect(decrypted).toBe(original);
    });

    it("長い文字列(数 KB)でも暗号化 → 復号で元に戻る", async () => {
      const original = "あ".repeat(5000);
      const encrypted = await encryptField(original);
      const decrypted = await decryptField(encrypted);
      expect(decrypted).toBe(original);
    });
  });

  describe("IV のランダム性", () => {
    it("同じ平文でも IV が違うため暗号文が毎回変わる", async () => {
      const original = "same plaintext";
      const a = await encryptField(original);
      const b = await encryptField(original);
      expect(a).not.toBe(b);
      // どちらも復号すると同じ平文に戻る
      expect(await decryptField(a)).toBe(original);
      expect(await decryptField(b)).toBe(original);
    });
  });

  describe("改竄検知", () => {
    it("暗号文の中央(ciphertext/authTag部)を変えると復号が throw する", async () => {
      const encrypted = await encryptField("secret");
      // 末尾 1 文字だけだと base64 のビット詰めの都合で実バイトが変わらない
      // ことがあるため、確実に ciphertext 部分に乗る位置(末尾から 5 文字目)を変える
      const idx = encrypted.length - 5;
      const ch = encrypted[idx];
      const swapped = ch === "A" ? "B" : "A";
      const tampered = encrypted.slice(0, idx) + swapped + encrypted.slice(idx + 1);
      await expect(decryptField(tampered)).rejects.toThrow();
    });

    it("IV 部分を書き換えても復号が throw する", async () => {
      const encrypted = await encryptField("secret");
      // プレフィックス直後(= IV の先頭)を書き換える
      const head = encrypted.slice(0, 3); // "v1:"
      const ivFirst = encrypted[3];
      const swapped = ivFirst === "A" ? "B" : "A";
      const tampered = head + swapped + encrypted.slice(4);
      await expect(decryptField(tampered)).rejects.toThrow();
    });
  });

  describe("移行互換(プレフィックス無しの平文)", () => {
    it('"v1:" が付いていない値はそのまま返る', async () => {
      const plain = "まだ暗号化されていない既存データ";
      const result = await decryptField(plain);
      expect(result).toBe(plain);
    });

    it('"vX:" 形式に見えてもプレフィックス検出されない値はそのまま返る', async () => {
      // "version:" のようなコロンを含むがバージョン形式ではない文字列
      const plain = "hello:world";
      const result = await decryptField(plain);
      expect(result).toBe(plain);
    });
  });

  describe("null / undefined / 空文字の扱い", () => {
    it("encryptField(null) は null を返す", async () => {
      expect(await encryptField(null)).toBeNull();
    });
    it("encryptField(undefined) は undefined を返す", async () => {
      expect(await encryptField(undefined)).toBeUndefined();
    });
    it('encryptField("") は "" を返す', async () => {
      expect(await encryptField("")).toBe("");
    });
    it("decryptField(null) は null を返す", async () => {
      expect(await decryptField(null)).toBeNull();
    });
    it("decryptField(undefined) は undefined を返す", async () => {
      expect(await decryptField(undefined)).toBeUndefined();
    });
    it('decryptField("") は "" を返す', async () => {
      expect(await decryptField("")).toBe("");
    });
  });

  describe("鍵ローテーション", () => {
    it("v1 で暗号化した値は、current が v2 に切り替わっても復号できる", async () => {
      // v1 が current の状態で暗号化
      setEnv({ v1: KEY_V1 }, "v1");
      const encryptedWithV1 = await encryptField("rotate me");
      expect(encryptedWithV1).toMatch(/^v1:/);

      // current を v2 に切り替え、両方の鍵を残しておく
      setEnv({ v1: KEY_V1, v2: KEY_V2 }, "v2");

      // 新規データは v2 で暗号化される
      const encryptedWithV2 = await encryptField("new data");
      expect(encryptedWithV2).toMatch(/^v2:/);

      // 旧データ(v1)も引き続き復号できる
      expect(await decryptField(encryptedWithV1)).toBe("rotate me");
      // 新データ(v2)も復号できる
      expect(await decryptField(encryptedWithV2)).toBe("new data");
    });

    it("暗号文の鍵バージョンに対応する鍵が無いと throw する", async () => {
      // v1 で暗号化(current=v1)
      setEnv({ v1: KEY_V1 }, "v1");
      const encryptedWithV1 = await encryptField("only v1 can read me");
      expect(encryptedWithV1).toMatch(/^v1:/);

      // 鍵セットから v1 を外す → v1 暗号文は復号できなくなる
      setEnv({ v2: KEY_V2 }, "v2");
      await expect(decryptField(encryptedWithV1)).rejects.toThrow(/鍵バージョン "v1"/);
    });
  });

  describe("環境変数のバリデーション", () => {
    it("FIELD_ENCRYPTION_KEYS が未設定なら明示的に throw する", async () => {
      delete process.env.FIELD_ENCRYPTION_KEYS;
      process.env.FIELD_ENCRYPTION_CURRENT_VERSION = "v1";
      __resetFieldEncryptionCacheForTests();
      await expect(encryptField("x")).rejects.toThrow(/FIELD_ENCRYPTION_KEYS/);
    });

    it("FIELD_ENCRYPTION_CURRENT_VERSION が未設定なら throw する", async () => {
      process.env.FIELD_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1 });
      delete process.env.FIELD_ENCRYPTION_CURRENT_VERSION;
      __resetFieldEncryptionCacheForTests();
      await expect(encryptField("x")).rejects.toThrow(/FIELD_ENCRYPTION_CURRENT_VERSION/);
    });

    it("鍵の長さが 32 バイトでないと throw する", async () => {
      // 16 バイトの鍵を渡す
      const shortKey = Buffer.alloc(16, 1).toString("base64");
      setEnv({ v1: shortKey }, "v1");
      await expect(encryptField("x")).rejects.toThrow(/AES-256/);
    });

    it("current バージョンに対応する鍵が無いと throw する", async () => {
      setEnv({ v1: KEY_V1 }, "v2");
      await expect(encryptField("x")).rejects.toThrow(/FIELD_ENCRYPTION_CURRENT_VERSION/);
    });

    it("FIELD_ENCRYPTION_KEYS が壊れた JSON だと throw する", async () => {
      process.env.FIELD_ENCRYPTION_KEYS = "{not json";
      process.env.FIELD_ENCRYPTION_CURRENT_VERSION = "v1";
      __resetFieldEncryptionCacheForTests();
      await expect(encryptField("x")).rejects.toThrow(/JSON/);
    });
  });
});
