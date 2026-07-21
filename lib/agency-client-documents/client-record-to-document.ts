/**
 * 顧客プロフィール(client_records)→ 履歴書 / 職務経歴書 への自動反映マッパー。
 *
 * なぜ必要か:
 *   エージェントは client_records に氏名・住所・学歴・希望条件などを蓄積しているのに、
 *   履歴書/CV の新規作成は空の書類を作るだけで、同じ内容を手で再入力していた
 *   (「プロフィールを設けている意味がない」状態)。新規作成時にこのマッパーで
 *   プロフィールから初期値を流し込む。
 *
 * セキュリティ:
 *   入力は復号済みの ClientRecordWithDecrypted(サーバ側でのみ取得)。出力の履歴書
 *   PII / CV 本文も encrypted_pii / encrypted_body として暗号化保存される。どちらも
 *   同一組織内(RLS)で扱う既存データの移送であり、新たな平文露出は発生しない。
 *   ブラウザには平文を渡さない(呼び出しはサーバの API ルートに限る)。
 */

import {
  CLIENT_EXTRACTION_FIELD_KEYS,
  CLIENT_EXTRACTION_KEY_TO_CAMEL,
  type ClientExtractionResult,
} from "@/lib/ai/prompts/client-extract-from-document";
import type { ClientRecordWithDecrypted } from "@/lib/clients/types";

import type { CvBody, EducationItem, LicenseItem, ResumePii } from "./types";

// client_records の性別(prefer_not_to_say を含む)→ 履歴書 PII の性別("" で未記載)
function mapGender(gender: ClientRecordWithDecrypted["gender"]): ResumePii["gender"] {
  if (gender === "male" || gender === "female" || gender === "other") return gender;
  return "";
}

// 都道府県〜建物名を 1 行に結合(履歴書 PII の address は単一フィールド、最大 300)
function joinAddress(client: ClientRecordWithDecrypted): string {
  return [client.prefecture, client.city, client.street, client.building]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ")
    .slice(0, 300);
}

// 希望条件(構造化タグ + 自由記述)を人が読める複数行テキストにまとめる。
// 履歴書「本人希望記入欄」と CV 本文の両方で使う。
function buildDesiredText(client: ClientRecordWithDecrypted): string {
  const lines: string[] = [];
  if (client.desiredIndustries.length)
    lines.push(`希望業種: ${client.desiredIndustries.join("、")}`);
  if (client.desiredOccupations.length)
    lines.push(`希望職種: ${client.desiredOccupations.join("、")}`);
  if (client.desiredLocations.length)
    lines.push(`希望勤務地: ${client.desiredLocations.join("、")}`);
  if (client.desiredAnnualIncome != null) lines.push(`希望年収: ${client.desiredAnnualIncome}万円`);
  if (client.desiredConditions) lines.push(client.desiredConditions);
  return lines.join("\n");
}

// 学歴詳細などの自由記述の先頭に「2015年4月」「2015/4」のような年月があれば、
// 履歴書の年月欄("YYYY/MM" 文字列)に切り出す。無ければ year は空。
function extractLeadingYearMonth(line: string): { year: string; description: string } {
  const match = line.match(/^\s*(\d{4})\s*[年./-]\s*(\d{1,2})?\s*月?\s*(.*)$/);
  if (match) {
    const year = match[1];
    const month = match[2] ? `/${match[2]}` : "";
    const rest = (match[3] ?? "").trim();
    return { year: `${year}${month}`, description: rest || line.trim() };
  }
  return { year: "", description: line.trim() };
}

/** client_record の基本 PII → 履歴書 PII */
export function clientRecordToResumePii(client: ClientRecordWithDecrypted): ResumePii {
  return {
    full_name: (client.name ?? "").slice(0, 100),
    full_name_kana: (client.nameKana ?? "").slice(0, 100),
    birth_date: (client.birthDate ?? "").slice(0, 10),
    gender: mapGender(client.gender),
    postal_code: (client.postalCode ?? "").slice(0, 10),
    address: joinAddress(client),
    phone: (client.phone ?? "").slice(0, 20),
    email: (client.email ?? "").slice(0, 254),
    // 転職理由 → 志望動機の下敷き、推薦コメント → 自己PR の下敷き(担当者が編集する前提)
    motivation: (client.jobChangeReason ?? "").slice(0, 2000),
    self_pr: (client.recommendationComment ?? "").slice(0, 2000),
    preferences: buildDesiredText(client).slice(0, 1000),
  };
}

/** 学歴詳細(自由記述)→ 履歴書の学歴・職歴行(1 行 = 1 レコード、年月は自動抽出) */
export function clientRecordToEducationHistory(client: ClientRecordWithDecrypted): EducationItem[] {
  if (!client.educationDetail) return [];
  return client.educationDetail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 50)
    .map((line) => {
      const { year, description } = extractLeadingYearMonth(line);
      return { year: year.slice(0, 7), description: description.slice(0, 500) };
    });
}

/** 保有資格・スキル(自由記述)→ 履歴書の免許・資格行(改行 /「/」「、」区切りで 1 件ずつ) */
export function clientRecordToLicenses(client: ClientRecordWithDecrypted): LicenseItem[] {
  if (!client.skills) return [];
  return client.skills
    .split(/[\r\n/、]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 50)
    .map((item) => ({ year: "", description: item.slice(0, 200) }));
}

/** client_record → 職務経歴書(CV)本文。構造化フィールドをセクション見出し付きで整形 */
export function clientRecordToCvBody(client: ClientRecordWithDecrypted): CvBody {
  const summaryParts: string[] = [];
  if (client.experienceOccupations.length)
    summaryParts.push(`職種: ${client.experienceOccupations.join("、")}`);
  if (client.experienceIndustries.length)
    summaryParts.push(`業種: ${client.experienceIndustries.join("、")}`);
  if (client.currentAnnualIncome != null)
    summaryParts.push(`現年収: ${client.currentAnnualIncome}万円`);

  const blocks: string[] = [];
  if (client.jobChangeReason) blocks.push(`【転職理由】\n${client.jobChangeReason}`);
  if (client.experienceIndustries.length || client.experienceOccupations.length) {
    blocks.push(
      `【経験】\n業種: ${client.experienceIndustries.join("、") || "―"}\n職種: ${
        client.experienceOccupations.join("、") || "―"
      }`,
    );
  }
  if (client.skills) blocks.push(`【保有スキル・資格】\n${client.skills}`);
  if (client.educationDetail) blocks.push(`【学歴】\n${client.educationDetail}`);
  const desired = buildDesiredText(client);
  if (desired) blocks.push(`【希望条件】\n${desired}`);
  if (client.recommendationComment) blocks.push(`【担当者所感】\n${client.recommendationComment}`);

  return {
    summary: summaryParts.join(" / ").slice(0, 2000),
    body: blocks.join("\n\n").slice(0, 20000),
  };
}

// ────────────────────────────────────────────────────────────────
// 書類(PDF/画像)の Vision 抽出結果からの生成
//
// extractClientFromDocument の ClientExtractionResult は client_records と同形の
// snake_case。上の client_record→書類マッパーへ流すため camelCase に詰め替える
// (抽出キーは client_records カラムと 1:1 で、CLIENT_EXTRACTION_KEY_TO_CAMEL が対応表)。
// これにより「書類→履歴書/CV」を新規ロジックほぼ無しで実現する。
// ────────────────────────────────────────────────────────────────
function clientExtractionToClientLike(
  extraction: ClientExtractionResult,
): ClientRecordWithDecrypted {
  const obj: Record<string, unknown> = {};
  for (const key of CLIENT_EXTRACTION_FIELD_KEYS) {
    obj[CLIENT_EXTRACTION_KEY_TO_CAMEL[key]] = extraction[key];
  }
  // マッパーが読む未抽出フィールド(recommendationComment 等)は undefined のままで
  // 良い(いずれも `?? ""` / falsy 判定でスキップされる)。
  return obj as unknown as ClientRecordWithDecrypted;
}

/** 書類抽出結果 → 履歴書 PII */
export function clientExtractionToResumePii(extraction: ClientExtractionResult): ResumePii {
  return clientRecordToResumePii(clientExtractionToClientLike(extraction));
}

/** 書類抽出結果 → 履歴書の学歴・職歴(年月自動抽出) */
export function clientExtractionToEducationHistory(
  extraction: ClientExtractionResult,
): EducationItem[] {
  return clientRecordToEducationHistory(clientExtractionToClientLike(extraction));
}

/** 書類抽出結果 → 履歴書の免許・資格 */
export function clientExtractionToLicenses(extraction: ClientExtractionResult): LicenseItem[] {
  return clientRecordToLicenses(clientExtractionToClientLike(extraction));
}

/** 書類抽出結果 → 職務経歴書(CV)本文 */
export function clientExtractionToCvBody(extraction: ClientExtractionResult): CvBody {
  return clientRecordToCvBody(clientExtractionToClientLike(extraction));
}
