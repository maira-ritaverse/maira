/**
 * クライアント名簿のデータ品質チェック(純関数)
 *
 * 「マッチング / 集計 / 連絡」の各業務に直結する平文フィールドの入力状況を点検。
 * 完了 / 見送り状態の顧客は対象外(終了済みなので入力催促の意味が薄い)。
 *
 * 出力:
 *   - フィールドごとの「未入力顧客数」
 *   - 全体の完全入力率(% of clients with all checked fields filled)
 *
 * UI はこの結果を「件数 + 該当顧客リスト」の widget で表示する。
 */
import type { ClientRecord } from "./types";

/** 点検対象のフィールド定義(平文のみ。暗号化フィールドは入力催促 UI で扱う) */
export type DataQualityField =
  | "phone"
  | "name_kana"
  | "prefecture"
  | "intake_date"
  | "current_employment_type"
  | "desired_locations"
  | "desired_annual_income"
  | "assigned_member_id";

export const DATA_QUALITY_FIELD_LABEL: Record<DataQualityField, string> = {
  phone: "電話番号",
  name_kana: "氏名カナ",
  prefecture: "都道府県",
  intake_date: "受付日",
  current_employment_type: "雇用形態",
  desired_locations: "希望勤務地",
  desired_annual_income: "希望年収",
  assigned_member_id: "担当者",
};

export type DataQualityCheckable = Pick<
  ClientRecord,
  | "id"
  | "name"
  | "status"
  | "phone"
  | "nameKana"
  | "prefecture"
  | "intakeDate"
  | "currentEmploymentType"
  | "desiredLocations"
  | "desiredAnnualIncome"
  | "assignedMemberId"
>;

export type DataQualityResult = {
  /** 評価対象の総顧客数(完了 / 見送り除外後) */
  evaluatedCount: number;
  /** 完全入力の顧客数 */
  completeCount: number;
  /** フィールド別の未入力件数 */
  missingByField: Record<DataQualityField, number>;
  /** フィールド別の未入力顧客 id + name(上位 5 件のみ。UI で「他 N 件」表示) */
  topMissingByField: Record<DataQualityField, Array<{ id: string; name: string }>>;
};

const TOP_N = 5;

function isMissing(client: DataQualityCheckable, field: DataQualityField): boolean {
  switch (field) {
    case "phone":
      return !client.phone || client.phone.trim() === "";
    case "name_kana":
      return !client.nameKana || client.nameKana.trim() === "";
    case "prefecture":
      return !client.prefecture || client.prefecture.trim() === "";
    case "intake_date":
      return client.intakeDate === null;
    case "current_employment_type":
      return client.currentEmploymentType === null;
    case "desired_locations":
      return client.desiredLocations.length === 0;
    case "desired_annual_income":
      return client.desiredAnnualIncome === null;
    case "assigned_member_id":
      return client.assignedMemberId === null;
  }
}

const ALL_FIELDS: DataQualityField[] = [
  "phone",
  "name_kana",
  "prefecture",
  "intake_date",
  "current_employment_type",
  "desired_locations",
  "desired_annual_income",
  "assigned_member_id",
];

/**
 * クライアント配列からデータ品質サマリを計算する。
 * 完了 / 見送り(status === 'completed' / 'declined')は除外。
 */
export function evaluateDataQuality(
  clients: ReadonlyArray<DataQualityCheckable>,
): DataQualityResult {
  const targets = clients.filter((c) => c.status !== "completed" && c.status !== "declined");

  const missingByField = Object.fromEntries(ALL_FIELDS.map((f) => [f, 0])) as Record<
    DataQualityField,
    number
  >;
  const topMissingByField = Object.fromEntries(
    ALL_FIELDS.map((f) => [f, [] as Array<{ id: string; name: string }>]),
  ) as Record<DataQualityField, Array<{ id: string; name: string }>>;

  let completeCount = 0;
  for (const c of targets) {
    let hasAnyMissing = false;
    for (const f of ALL_FIELDS) {
      if (isMissing(c, f)) {
        hasAnyMissing = true;
        missingByField[f] += 1;
        if (topMissingByField[f].length < TOP_N) {
          topMissingByField[f].push({ id: c.id, name: c.name });
        }
      }
    }
    if (!hasAnyMissing) completeCount += 1;
  }

  return {
    evaluatedCount: targets.length,
    completeCount,
    missingByField,
    topMissingByField,
  };
}
