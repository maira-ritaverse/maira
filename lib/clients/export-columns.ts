/**
 * CSV エクスポートの列定義(クライアント名簿用)
 *
 * UI のチェックボックスと API ルートの列出力を 1 つの定義に集約する。
 * 文字列キー(column key)で受け渡し、UI ↔ API 間の契約をシンプルに保つ。
 *
 * セキュリティ方針:
 *   - 暗号化フィールドはここでは出力しない(平文化したものを CSV に流すと
 *     復号鍵が無いとアクセスできない情報まで漏れるリスクが上がる)。
 *     必要であれば「個別の詳細画面で確認 + コピー」運用にする。
 *   - 連携状態 / 連携 user_id 等の内部 ID は出力しない(運用時に意味薄)。
 */
import {
  clientEmploymentTypeLabels,
  clientFinalEducationLabels,
  clientGenderLabels,
  clientJobChangeTimingLabels,
  clientLinkStatusLabels,
  clientMaritalStatusLabels,
  clientStatusLabels,
  type ClientRecordWithAssignee,
  type ClientEmploymentType,
  type ClientFinalEducation,
  type ClientGender,
  type ClientJobChangeTiming,
  type ClientMaritalStatus,
} from "./types";

/** CSV 出力可能な列の Key。UI / API の URL クエリ両方で使う。 */
export type ExportColumnKey =
  | "name"
  | "name_kana"
  | "email"
  | "phone"
  | "status"
  | "link_status"
  | "assignee"
  | "entry_site"
  | "intake_date"
  | "first_meeting_date"
  | "prefecture"
  | "city"
  | "postal_code"
  | "birth_date"
  | "gender"
  | "nationality"
  | "marital_status"
  | "phone2"
  | "email2"
  | "current_employment_type"
  | "current_annual_income"
  | "final_education"
  | "experience_industries"
  | "experience_occupations"
  | "desired_industries"
  | "desired_occupations"
  | "desired_locations"
  | "desired_annual_income"
  | "job_change_timing"
  | "crm_tags"
  | "close_reason"
  | "email_distribution_enabled"
  | "notes"
  | "created_at"
  | "updated_at";

/** 列ごとの定義:CSV ヘッダー名と、ClientRecordWithAssignee からの値抽出関数。 */
export type ExportColumnDef = {
  key: ExportColumnKey;
  label: string;
  getValue: (c: ClientRecordWithAssignee) => string | null;
};

/** クローズ理由のラベル(filter-sort 等と無関係なのでここに定義) */
const CLOSE_REASON_LABEL: Record<string, string> = {
  declined: "見送り",
  self_arranged: "自己手配",
  other_agency: "他社経由",
  unresponsive: "連絡不能",
  ineligible: "条件不一致",
  passed_screening: "選考通過",
  other: "その他",
};

/** 単一の YYYY-MM-DD → そのまま返す helper。null セーフ。 */
const passthroughOrNull = (v: string | null): string | null => v;

/** 列定義リスト(順序が UI / CSV の出力順を決める)。 */
export const EXPORT_COLUMNS: ExportColumnDef[] = [
  { key: "name", label: "氏名", getValue: (c) => c.name },
  { key: "name_kana", label: "氏名カナ", getValue: (c) => c.nameKana },
  { key: "email", label: "メール", getValue: (c) => c.email },
  { key: "phone", label: "電話", getValue: (c) => c.phone },
  { key: "status", label: "対応状況", getValue: (c) => clientStatusLabels[c.status] },
  {
    key: "link_status",
    label: "連携状況",
    getValue: (c) => clientLinkStatusLabels[c.linkStatus],
  },
  { key: "assignee", label: "担当アドバイザー", getValue: (c) => c.assigneeName },
  { key: "entry_site", label: "エントリーサイト", getValue: (c) => c.entrySite },
  { key: "intake_date", label: "受付日", getValue: (c) => passthroughOrNull(c.intakeDate) },
  {
    key: "first_meeting_date",
    label: "面談実施日",
    getValue: (c) => passthroughOrNull(c.firstMeetingDate),
  },
  { key: "prefecture", label: "都道府県", getValue: (c) => c.prefecture },
  { key: "city", label: "市区町村", getValue: (c) => c.city },
  { key: "postal_code", label: "郵便番号", getValue: (c) => c.postalCode },
  { key: "birth_date", label: "生年月日", getValue: (c) => c.birthDate },
  {
    key: "gender",
    label: "性別",
    getValue: (c) => (c.gender ? clientGenderLabels[c.gender as ClientGender] : null),
  },
  { key: "nationality", label: "国籍", getValue: (c) => c.nationality },
  {
    key: "marital_status",
    label: "婚姻状況",
    getValue: (c) =>
      c.maritalStatus ? clientMaritalStatusLabels[c.maritalStatus as ClientMaritalStatus] : null,
  },
  { key: "phone2", label: "電話 2", getValue: (c) => c.phone2 },
  { key: "email2", label: "メール 2", getValue: (c) => c.email2 },
  {
    key: "current_employment_type",
    label: "雇用形態",
    getValue: (c) =>
      c.currentEmploymentType
        ? clientEmploymentTypeLabels[c.currentEmploymentType as ClientEmploymentType]
        : null,
  },
  {
    key: "current_annual_income",
    label: "現年収(万円)",
    getValue: (c) => (c.currentAnnualIncome === null ? null : String(c.currentAnnualIncome)),
  },
  {
    key: "final_education",
    label: "最終学歴",
    getValue: (c) =>
      c.finalEducation
        ? clientFinalEducationLabels[c.finalEducation as ClientFinalEducation]
        : null,
  },
  {
    key: "experience_industries",
    label: "経験業種",
    getValue: (c) =>
      c.experienceIndustries.length === 0 ? null : c.experienceIndustries.join(", "),
  },
  {
    key: "experience_occupations",
    label: "経験職種",
    getValue: (c) =>
      c.experienceOccupations.length === 0 ? null : c.experienceOccupations.join(", "),
  },
  {
    key: "desired_industries",
    label: "希望業種",
    getValue: (c) => (c.desiredIndustries.length === 0 ? null : c.desiredIndustries.join(", ")),
  },
  {
    key: "desired_occupations",
    label: "希望職種",
    getValue: (c) => (c.desiredOccupations.length === 0 ? null : c.desiredOccupations.join(", ")),
  },
  {
    key: "desired_locations",
    label: "希望勤務地",
    getValue: (c) => (c.desiredLocations.length === 0 ? null : c.desiredLocations.join(", ")),
  },
  {
    key: "desired_annual_income",
    label: "希望年収(万円)",
    getValue: (c) => (c.desiredAnnualIncome === null ? null : String(c.desiredAnnualIncome)),
  },
  {
    key: "job_change_timing",
    label: "転職時期",
    getValue: (c) =>
      c.jobChangeTiming
        ? clientJobChangeTimingLabels[c.jobChangeTiming as ClientJobChangeTiming]
        : null,
  },
  {
    key: "crm_tags",
    label: "CRM タグ",
    getValue: (c) => (c.crmTags.length === 0 ? null : c.crmTags.join(", ")),
  },
  {
    key: "close_reason",
    label: "クローズ理由",
    getValue: (c) => (c.closeReason ? (CLOSE_REASON_LABEL[c.closeReason] ?? c.closeReason) : null),
  },
  {
    key: "email_distribution_enabled",
    label: "MA 配信",
    getValue: (c) => (c.emailDistributionEnabled ? "許可" : "停止"),
  },
  { key: "notes", label: "備考", getValue: (c) => c.notes },
  { key: "created_at", label: "登録日時", getValue: (c) => c.createdAt },
  { key: "updated_at", label: "更新日時", getValue: (c) => c.updatedAt },
];

/** デフォルトで選択する列(従来のエクスポート互換 + よく使う運用列)。 */
export const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  "name",
  "name_kana",
  "email",
  "phone",
  "status",
  "link_status",
  "assignee",
  "intake_date",
  "prefecture",
  "current_employment_type",
  "notes",
  "created_at",
];

/**
 * URL クエリ ?columns=name,email,phone から ExportColumnKey の配列を返す。
 * 未知のキーは無視。空 / 未指定なら DEFAULT_EXPORT_COLUMNS を返す。
 */
export function parseExportColumnsParam(raw: string | null): ExportColumnKey[] {
  if (!raw) return DEFAULT_EXPORT_COLUMNS;
  const known = new Set<string>(EXPORT_COLUMNS.map((c) => c.key));
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && known.has(s)) as ExportColumnKey[];
  return parsed.length > 0 ? parsed : DEFAULT_EXPORT_COLUMNS;
}
