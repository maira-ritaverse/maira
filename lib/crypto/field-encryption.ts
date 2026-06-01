/**
 * フィールド単位の AES-256-GCM 暗号化ユーティリティ
 *
 * 履歴書などの PII を「DB には暗号文として保存し、アプリ層でだけ復号する」
 * ための共通モジュール。Web Crypto API (crypto.subtle) のみを使い、
 * Node ランタイム・Edge ランタイム・ブラウザのいずれでも同じコードで動く。
 * node:crypto は使わない(Edge/Deno で動かないため)。
 *
 * --- 開発用の鍵生成手順 ---
 * 32 バイトのランダム値を base64 で出力する例:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * 出てきた文字列を FIELD_ENCRYPTION_KEYS の v1 に設定する。
 *
 * .env.local の設定例:
 *   FIELD_ENCRYPTION_KEYS={"v1":"<base64-32byte>"}
 *   FIELD_ENCRYPTION_CURRENT_VERSION=v1
 *
 * 実際の鍵値はコミットしない。dev と prod では必ず別の鍵を使う。
 *
 * --- 暗号文の保存フォーマット ---
 *   "v{n}:" + base64url(iv(12B) ‖ ciphertext+authTag)
 *
 * プレフィックスで鍵バージョンを判別するため、将来 v2 を追加して
 * FIELD_ENCRYPTION_CURRENT_VERSION を v2 に切り替えれば、
 * 新規データは v2 で暗号化されつつ v1 の旧データも引き続き復号できる
 * (= 鍵ローテーション)。
 *
 * --- 移行互換 ---
 * プレフィックスが無い値は「Step 3 のバックフィル前の平文データ」と
 * 見なしてそのまま返す。平文と暗号文が混在する移行期間を安全に通り抜ける
 * ためのフォールバック。Step 3 でバックフィルが完了したら、このフォール
 * バックは将来的に外す想定。
 */

// AES-256 の鍵長(バイト)
const KEY_LENGTH_BYTES = 32;
// AES-GCM の標準 IV 長(バイト)。GCM では 12B が推奨。
const IV_LENGTH_BYTES = 12;
// "v{数字}:" プレフィックスを切り出す正規表現
const VERSION_PREFIX_RE = /^(v\d+):(.+)$/;

type KeyMap = Map<string, CryptoKey>;
type LoadedKeys = { keys: KeyMap; current: string };

// 鍵は環境変数から 1 度だけロードしてキャッシュする。
// プロセス内でホットパス(API ルート)から呼ばれるため毎回 import するのは避ける。
let cached: LoadedKeys | null = null;

/**
 * base64(標準) → Uint8Array
 * Buffer を使わず atob で実装(Edge ランタイムでも動かすため)。
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Uint8Array → base64url(URL/ファイル名で安全な base64)
 * "+" "/" "=" を含まないため DB のテキスト列に入れても扱いやすい。
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * base64url → Uint8Array
 */
function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  // base64 のパディングを 4 の倍数になるように補う
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return base64ToBytes(padded);
}

/**
 * 環境変数から鍵マップをロードしてキャッシュする。
 * 不正な設定は明確なエラーで即座に気づけるようバリデーションする。
 */
async function loadKeys(): Promise<LoadedKeys> {
  if (cached) {
    return cached;
  }

  const raw = process.env.FIELD_ENCRYPTION_KEYS;
  const current = process.env.FIELD_ENCRYPTION_CURRENT_VERSION;

  if (!raw) {
    throw new Error(
      "FIELD_ENCRYPTION_KEYS is not set. " +
        '.env.local に {"v1":"<base64-32byte>"} 形式で設定してください。',
    );
  }
  if (!current) {
    throw new Error('FIELD_ENCRYPTION_CURRENT_VERSION is not set (例: "v1")。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "FIELD_ENCRYPTION_KEYS が JSON として不正です。" +
        '{"v1":"<base64-32byte>"} 形式で設定してください。',
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'FIELD_ENCRYPTION_KEYS はオブジェクト形式である必要があります(例: {"v1":"..."})',
    );
  }

  const keys: KeyMap = new Map();
  for (const [version, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^v\d+$/.test(version)) {
      throw new Error(`鍵バージョン名 "${version}" は v<number> 形式にしてください(例: v1)。`);
    }
    if (typeof value !== "string") {
      throw new Error(`鍵バージョン ${version} の値は base64 文字列にしてください。`);
    }

    let rawKey: Uint8Array;
    try {
      rawKey = base64ToBytes(value);
    } catch {
      throw new Error(`鍵バージョン ${version} の base64 デコードに失敗しました。`);
    }
    if (rawKey.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `鍵バージョン ${version} のバイト長が ${rawKey.length} です。` +
          `AES-256 のため ${KEY_LENGTH_BYTES} バイトにしてください。`,
      );
    }

    const key = await crypto.subtle.importKey(
      "raw",
      // Uint8Array<ArrayBufferLike> → BufferSource キャスト。
      // 実際は Uint8Array<ArrayBuffer> だが、TS の型定義が SharedArrayBuffer
      // 由来かもしれないと判断するため明示的に詰める。
      rawKey as BufferSource,
      { name: "AES-GCM" },
      // extractable=false で「鍵そのものを取り出せない」状態にする。
      // メモリダンプ等での流出リスクを少しでも下げるための保険。
      false,
      ["encrypt", "decrypt"],
    );
    keys.set(version, key);
  }

  if (!keys.has(current)) {
    throw new Error(
      `FIELD_ENCRYPTION_CURRENT_VERSION="${current}" に対応する鍵が ` +
        "FIELD_ENCRYPTION_KEYS にありません。",
    );
  }

  cached = { keys, current };
  return cached;
}

/**
 * テスト用にキャッシュをリセットする。本番コードからは呼ばないこと。
 * 環境変数を差し替えて再ロードさせるためだけのエスケープハッチ。
 */
export function __resetFieldEncryptionCacheForTests(): void {
  cached = null;
}

/**
 * 平文を AES-256-GCM で暗号化して "v{n}:base64url" 形式で返す。
 *
 * - null / undefined / 空文字はそのまま返す(暗号化しない)
 *   → DB の NOT NULL 制約や空文字のセマンティクスを変えないため
 * - IV はレコードごとに新規生成(同じ平文でも毎回異なる暗号文になる)
 */
export function encryptField(plaintext: null): Promise<null>;
export function encryptField(plaintext: undefined): Promise<undefined>;
export function encryptField(plaintext: ""): Promise<"">;
export function encryptField(plaintext: string): Promise<string>;
export function encryptField(
  plaintext: string | null | undefined,
): Promise<string | null | undefined>;
export async function encryptField(
  plaintext: string | null | undefined,
): Promise<string | null | undefined> {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return plaintext;
  }

  const { keys, current } = await loadKeys();
  // current バージョンは loadKeys 内で存在保証済み
  const key = keys.get(current)!;

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
  );

  // iv ‖ ciphertext+authTag を 1 つのバイト列にまとめてエンコード
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);

  return `${current}:${bytesToBase64Url(combined)}`;
}

/**
 * "v{n}:base64url" 形式の暗号文を復号して平文を返す。
 *
 * - null / undefined / 空文字はそのまま返す
 * - プレフィックスが無い値は移行前の平文と見なしてそのまま返す
 *   (Step 3 のバックフィル中に平文と暗号文が混在しても落ちないようにする)
 * - GCM 認証タグが一致しなければ crypto.subtle.decrypt が例外を投げる
 *   → 改竄や鍵不一致を確実に検知できる
 * - 暗号文の鍵バージョンが未登録なら明示的に throw する
 */
export function decryptField(value: null): Promise<null>;
export function decryptField(value: undefined): Promise<undefined>;
export function decryptField(value: ""): Promise<"">;
export function decryptField(value: string): Promise<string>;
export function decryptField(value: string | null | undefined): Promise<string | null | undefined>;
export async function decryptField(
  value: string | null | undefined,
): Promise<string | null | undefined> {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  const match = value.match(VERSION_PREFIX_RE);
  if (!match) {
    // プレフィックス無し = Step 3 移行前の平文データ。
    // ここで throw すると移行中の画面が全滅するためそのまま返す。
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
    // IV だけ、あるいは IV 未満。明らかに壊れている。
    throw new Error("暗号文の長さが不正です(IV 部分しかありません)。");
  }

  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  // AES-GCM の decrypt は認証タグ不一致時に DOMException("OperationError") を投げる
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

  return new TextDecoder().decode(plaintext);
}
