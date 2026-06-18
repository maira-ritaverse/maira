/**
 * AgencyClientResume(エージェント所有・PII ネスト型) → seeker Resume
 *(厚労省様式 1 枚物のフラット型)に変換するマッパー。
 *
 * 目的:
 *   ・既存の lib/resumes/resume-html.ts(buildResumeHtml)を再利用するため、
 *     入力型を Resume に揃える。エージェント側で別の HTML テンプレートを
 *     二重管理するのを避ける。
 *   ・教育・職歴・資格は year を "YYYY/MM" 文字列(エージェント側)
 *     → 数値 year + month(seeker 側)に分解する。
 *
 * 注意:
 *   ・本マッパーは PDF / プレビュー HTML 用途専用。DB に書き戻すための
 *     型変換ではない(片方向)。
 *   ・id は組織モデルの id をそのまま入れる(HTML 生成では使用しないが、
 *     型整合のため)。
 */
import type {
  AgencyClientResume,
  EducationItem as AgencyEducationItem,
  LicenseItem as AgencyLicenseItem,
} from "./types";
import type {
  EducationItem as SeekerEducationItem,
  Gender,
  LicenseItem as SeekerLicenseItem,
  Resume,
} from "@/lib/resumes/types";

const parseYearMonth = (raw: string): { year: number | null; month: number | null } => {
  if (!raw) return { year: null, month: null };
  const m = raw.match(/^(\d{4})(?:[/-](\d{1,2}))?$/);
  if (!m) return { year: null, month: null };
  const year = Number.parseInt(m[1], 10);
  const month = m[2] ? Number.parseInt(m[2], 10) : null;
  return { year, month };
};

const toSeekerEducation = (it: AgencyEducationItem): SeekerEducationItem => {
  const { year, month } = parseYearMonth(it.year);
  return {
    year: year ?? null,
    month: month ?? null,
    description: (it.description ?? "").slice(0, 200),
  };
};

const toSeekerLicense = (it: AgencyLicenseItem): SeekerLicenseItem => {
  const { year, month } = parseYearMonth(it.year);
  return {
    year: year ?? null,
    month: month ?? null,
    name: (it.description ?? "").slice(0, 200),
  };
};

const toGender = (raw: string): Gender | null => {
  if (raw === "male") return "male";
  if (raw === "female") return "female";
  if (raw === "other" || raw === "") return "unspecified";
  return null;
};

/**
 * エージェント所有の履歴書 を seeker 標準の Resume 型に変換する。
 * buildResumeHtml にそのまま渡せる形にする。
 */
export function agencyClientResumeToSeekerResume(resume: AgencyClientResume): Resume {
  const pii = resume.pii;
  return {
    id: resume.id,
    userId: resume.organizationId, // HTML 生成では参照しないので組織 ID で代用
    title: resume.title,
    name: pii.full_name || null,
    nameKana: pii.full_name_kana || null,
    birthDate: pii.birth_date || null,
    gender: toGender(pii.gender ?? ""),
    postalCode: pii.postal_code || null,
    address: pii.address || null,
    addressKana: null,
    phone: pii.phone || null,
    email: pii.email || null,
    // 連絡先は履歴書様式の「現住所と異なる連絡先」欄。エージェント側では持たないので null。
    contactAddress: null,
    contactAddressKana: null,
    contactPhone: null,
    // 写真:Resume.photoUrl は Storage パスを保持(buildResumeHtml は別途
    // 署名URLを渡すための options.photoSignedUrl を見るので、ここでは
    // パスを保持しておく)
    photoUrl: resume.photoStoragePath,
    documentDate: resume.documentDate,
    educationHistory: resume.educationHistory.map(toSeekerEducation),
    licenses: resume.licenses.map(toSeekerLicense),
    // 厚労省様式の自由記述欄に PII.motivation を流し込む(志望動機 / アピール)
    motivationNote: pii.motivation || null,
    // 本人希望記入欄
    personalRequests: pii.preferences || null,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  };
}
