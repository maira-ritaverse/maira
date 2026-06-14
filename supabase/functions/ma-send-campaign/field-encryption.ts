/**
 * フィールド暗号化(Edge Function / Deno 版)
 *
 * Web 側 `lib/crypto/field-encryption.ts` と同じ AES-256-GCM ロジックを
 * Deno ランタイム向けに移植したもの。両者は同じ鍵・同じフォーマット
 * (`v{n}:base64url(iv ‖ ct+authTag)`)を使うため、Web で暗号化したものを
 * ここで復号でき、ここで暗号化したものを Web で復号できる。
 *
 * 違いは「環境変数の取り方だけ」:
 *   - Web: process.env.FIELD_ENCRYPTION_KEYS
 *   - Deno: Deno.env.get("FIELD_ENCRYPTION_KEYS")
 *
 * Supabase Secrets に同名の値を設定すれば共通の鍵で動く。
 */

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const VERSION_PREFIX_RE = /^(v\d+):(.+)$/;

type KeyMap = Map<string, CryptoKey>;
type LoadedKeys = { keys: KeyMap; current: string };

let cached: LoadedKeys | null = null;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return base64ToBytes(padded);
}

async function loadKeys(): Promise<LoadedKeys> {
  if (cached) return cached;

  const raw = Deno.env.get("FIELD_ENCRYPTION_KEYS");
  const current = Deno.env.get("FIELD_ENCRYPTION_CURRENT_VERSION");

  if (!raw) {
    throw new Error(
      'FIELD_ENCRYPTION_KEYS が未設定です。supabase secrets set FIELD_ENCRYPTION_KEYS=\'{"v1":"<base64-32byte>"}\' で設定してください。',
    );
  }
  if (!current) {
    throw new Error('FIELD_ENCRYPTION_CURRENT_VERSION が未設定です(例: "v1")。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FIELD_ENCRYPTION_KEYS が JSON として不正です。");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("FIELD_ENCRYPTION_KEYS はオブジェクト形式である必要があります。");
  }

  const keys: KeyMap = new Map();
  for (const [version, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^v\d+$/.test(version)) {
      throw new Error(`鍵バージョン名 "${version}" は v<number> 形式にしてください。`);
    }
    if (typeof value !== "string") {
      throw new Error(`鍵バージョン ${version} の値は base64 文字列にしてください。`);
    }
    const rawKey = base64ToBytes(value);
    if (rawKey.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `鍵バージョン ${version} のバイト長が ${rawKey.length} です(${KEY_LENGTH_BYTES} 必要)。`,
      );
    }
    const key = await crypto.subtle.importKey(
      "raw",
      rawKey as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    keys.set(version, key);
  }

  if (!keys.has(current)) {
    throw new Error(
      `FIELD_ENCRYPTION_CURRENT_VERSION="${current}" に対応する鍵が FIELD_ENCRYPTION_KEYS にありません。`,
    );
  }

  cached = { keys, current };
  return cached;
}

export async function encryptField(plaintext: string): Promise<string> {
  if (plaintext === "") return "";
  const { keys, current } = await loadKeys();
  const key = keys.get(current)!;

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
  );

  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);

  return `${current}:${bytesToBase64Url(combined)}`;
}

export async function decryptField(value: string | null): Promise<string | null> {
  if (value === null || value === "") return value;

  const match = value.match(VERSION_PREFIX_RE);
  if (!match) {
    // プレフィックス無し = 移行前の平文。そのまま返す。
    return value;
  }

  const version = match[1];
  const payload = match[2];

  const { keys } = await loadKeys();
  const key = keys.get(version);
  if (!key) {
    throw new Error(
      `暗号文の鍵バージョン "${version}" に対応する鍵が FIELD_ENCRYPTION_KEYS にありません。`,
    );
  }

  const combined = base64UrlToBytes(payload);
  if (combined.length <= IV_LENGTH_BYTES) {
    throw new Error("暗号文の長さが不正です(IV 部分しかありません)。");
  }

  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
