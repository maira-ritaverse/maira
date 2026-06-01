import {
  educationItemSchema,
  licenseItemSchema,
  type EducationItem,
  type Gender,
  type LicenseItem,
} from "./types";

/**
 * 履歴書 PII の単一の真実(Single Source of Truth)
 *
 * docs/encryption-manifest.md の resumes 章で [ENCRYPT] / [DECISION] と判定された
 * カラムをこのファイルに集約する。Step 3a 以降で「暗号化 blob に入れる項目」を
 * 増減するときは、必ずこのファイルを更新する。
 *
 * 設計方針:
 *   - blob には camelCase ではなく DB のカラム名(snake_case)で詰める。
 *     queries.ts での dual-write がそのまま使えるようにするため。
 *   - date / jsonb 系は blob 内ではプリミティブにシリアライズする
 *     (date → ISO 文字列 "YYYY-MM-DD" / jsonb → 元の配列をそのまま)。
 *   - [KEEP] 項目(id, user_id, title, status系, timestamp, document_date)は
 *     blob に入れない。クエリで使うため平文維持。
 */

// ============================================
// blob に入れる PII フィールドの名前(DB カラム名)
//
// ここに列挙したものが「DB の個別 PII カラム」と「encrypted_pii 内の JSON」の
// 両方に書かれる(dual-write)。読み取り時は blob が優先される。
// ============================================
export const RESUME_PII_FIELDS = [
  // 本人基本情報
  "name",
  "name_kana",
  "birth_date", // date 型カラム / blob 内では "YYYY-MM-DD" 文字列
  "gender", // CHECK 制約付き text / blob 内でも同じ enum 値
  // 現住所
  "postal_code",
  "address",
  "address_kana",
  "phone",
  "email",
  // 連絡先(現住所と異なる場合)
  "contact_address",
  "contact_address_kana",
  "contact_phone",
  // 写真
  "photo_url",
  // 学歴・職歴 / 免許・資格(jsonb)
  "education_history",
  "licenses",
  // 自由記述
  "motivation_note",
  "personal_requests",
] as const;

export type ResumePiiFieldName = (typeof RESUME_PII_FIELDS)[number];

// ============================================
// blob にシリアライズする時の値の型
//
// DB の text 系は string | null、date は ISO 文字列、jsonb は配列、
// gender は CHECK 制約付き enum、と分かれる。下流コードに渡す Resume 型
// (camelCase)に変換する手前のスナップショット。
// ============================================
export type ResumePii = {
  name: string | null;
  name_kana: string | null;
  birth_date: string | null; // "YYYY-MM-DD" or null
  gender: Gender | null;
  postal_code: string | null;
  address: string | null;
  address_kana: string | null;
  phone: string | null;
  email: string | null;
  contact_address: string | null;
  contact_address_kana: string | null;
  contact_phone: string | null;
  photo_url: string | null;
  education_history: EducationItem[];
  licenses: LicenseItem[];
  motivation_note: string | null;
  personal_requests: string | null;
};

// ============================================
// 安全に PII を組み立てるヘルパー
// ============================================

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}

function isGender(value: unknown): value is Gender {
  return value === "male" || value === "female" || value === "unspecified";
}

function parseEducationHistory(value: unknown): EducationItem[] {
  if (!Array.isArray(value)) return [];
  const result: EducationItem[] = [];
  for (const item of value) {
    const parsed = educationItemSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

function parseLicenses(value: unknown): LicenseItem[] {
  if (!Array.isArray(value)) return [];
  const result: LicenseItem[] = [];
  for (const item of value) {
    const parsed = licenseItemSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

/**
 * 任意のオブジェクト(DB 行 / SaveResumeRequest など)から PII フィールドだけを
 * 抜き出して ResumePii オブジェクトに整える。
 *
 * 文字列系は型違いを全て null に倒す。jsonb 系は zod でスキーマ検証する。
 * (UI から壊れた値が来ても暗号化前に正規化しておくため)
 */
export function pickResumePii(source: Record<string, unknown>): ResumePii {
  return {
    name: nullableString(source.name),
    name_kana: nullableString(source.name_kana),
    birth_date: nullableString(source.birth_date),
    gender: isGender(source.gender) ? source.gender : null,
    postal_code: nullableString(source.postal_code),
    address: nullableString(source.address),
    address_kana: nullableString(source.address_kana),
    phone: nullableString(source.phone),
    email: nullableString(source.email),
    contact_address: nullableString(source.contact_address),
    contact_address_kana: nullableString(source.contact_address_kana),
    contact_phone: nullableString(source.contact_phone),
    photo_url: nullableString(source.photo_url),
    education_history: parseEducationHistory(source.education_history),
    licenses: parseLicenses(source.licenses),
    motivation_note: nullableString(source.motivation_note),
    personal_requests: nullableString(source.personal_requests),
  };
}

/**
 * ResumePii を JSON 文字列に直す(encryptField への入力)。
 * フィールド順を RESUME_PII_FIELDS に揃えるため、安易に JSON.stringify(pii) ではなく
 * 列挙順で再構築する(差分レビュー時に並びがブレないように)。
 */
export function serializeResumePii(pii: ResumePii): string {
  const ordered: Record<string, unknown> = {};
  for (const field of RESUME_PII_FIELDS) {
    ordered[field] = pii[field];
  }
  return JSON.stringify(ordered);
}

/**
 * 復号後の JSON 文字列を ResumePii に戻す。
 * 想定外のデータが入っていても pickResumePii を通して正規化する。
 */
export function deserializeResumePii(json: string): ResumePii {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // 壊れた JSON。ここで throw すると画面全体が落ちるので空の PII を返す。
    // dual-write 中は個別カラムにも値があるためフォールバックが効く想定。
    return pickResumePii({});
  }
  if (typeof parsed !== "object" || parsed === null) {
    return pickResumePii({});
  }
  return pickResumePii(parsed as Record<string, unknown>);
}
