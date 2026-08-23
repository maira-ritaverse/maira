/**
 * エージェント送付ドラフト(document_drafts_from_agency)の payload を、
 * 求職者本人の履歴書 / 職務経歴書 保存リクエストへ変換する純関数。
 *
 * エージェント側(lib/agency-client-documents)と求職者側(lib/resumes, lib/cvs)は
 * スキーマが異なる:
 *   - 履歴書: 項目名(full_name→name 等)・文字数上限・gender enum・学歴/資格の year 表現
 *     (agency は "YYYY/MM" 文字列、seeker は year:number + month:number)が違う。
 *   - 職務経歴書: agency は {summary, body(自由文)}、seeker は
 *     {summary, work_experiences[], skills[], self_pr} で構造が大きく異なる。
 *     自由文 body を構造化 work_experiences へ忠実変換できないため、summary と self_pr に
 *     クランプして写す best-effort とする(受領後に本人が整形する前提)。
 *
 * いずれも最後に seeker 側スキーマで parse して返す(上限超過等で throw する場合は
 * 呼び出し側が受領を失敗扱いにでき、壊れた書類を作らない)。
 */
import { z } from "zod";

import { saveCvRequestSchema, type SaveCvRequest } from "@/lib/cvs/types";
import { saveResumeRequestSchema, type SaveResumeRequest } from "@/lib/resumes/types";

import type { DocumentDraftPayload } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function clamp(v: string, n: number): string {
  return v.length > n ? v.slice(0, n) : v;
}

/** "2020" / "2020/03" / "2020-3" / "" を {year, month} に分解(範囲外は null)。 */
export function parseYearMonth(raw: string): { year: number | null; month: number | null } {
  const m = raw.match(/(\d{4})(?:[/\-.](\d{1,2}))?/);
  if (!m) return { year: null, month: null };
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : null;
  return {
    year: year >= 1950 && year <= 2100 ? year : null,
    month: month !== null && month >= 1 && month <= 12 ? month : null,
  };
}

function mapGender(raw: unknown): "male" | "female" | "unspecified" | null {
  if (raw === "male" || raw === "female") return raw;
  if (raw === "other") return "unspecified";
  return null;
}

// 求職者スキーマの email は zod `.email()` で検証される。独自正規表現だと zod より緩く、
// 通ってしまった値で最終 parse が throw し受領が永久に失敗する。zod と同じ判定に揃え、
// 通らない値は空にフォールバックする(受領は必ず成功させる)。
const emailCheck = z.string().email();
function safeEmail(raw: string): string {
  const v = clamp(raw, 254);
  return emailCheck.safeParse(v).success ? v : "";
}

/**
 * 履歴書ドラフト payload → 求職者履歴書 SaveResumeRequest。
 */
export function agencyResumePayloadToSaveRequest(
  payload: DocumentDraftPayload,
  title: string,
): SaveResumeRequest {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const pii = (data.pii ?? {}) as Record<string, unknown>;
  const eduRaw = Array.isArray(data.education_history) ? data.education_history : [];
  const licRaw = Array.isArray(data.licenses) ? data.licenses : [];

  const motivation = str(pii.motivation) || str(payload.motivation_note);
  const selfPr = str(pii.self_pr) || str(payload.self_pr);
  const motivationNote = clamp([motivation, selfPr].filter(Boolean).join("\n\n"), 1000);

  const education_history = eduRaw.slice(0, 50).map((e) => {
    const item = (e ?? {}) as Record<string, unknown>;
    const { year, month } = parseYearMonth(str(item.year));
    return { year, month, description: clamp(str(item.description), 500) };
  });
  const licenses = licRaw.slice(0, 50).map((l) => {
    const item = (l ?? {}) as Record<string, unknown>;
    const { year, month } = parseYearMonth(str(item.year));
    // agency は description、seeker は name。どちらでも拾えるようにする。
    return { year, month, name: clamp(str(item.description) || str(item.name), 200) };
  });

  const req = {
    title: clamp(title || "履歴書", 100),
    name: clamp(str(pii.full_name), 100),
    name_kana: clamp(str(pii.full_name_kana), 100),
    birth_date: str(pii.birth_date),
    gender: mapGender(pii.gender),
    postal_code: clamp(str(pii.postal_code), 10),
    address: clamp(str(pii.address), 200),
    address_kana: clamp(str(pii.address_kana), 200),
    phone: clamp(str(pii.phone), 20),
    email: safeEmail(str(pii.email)),
    contact_address: "",
    contact_address_kana: "",
    contact_phone: "",
    document_date: "",
    education_history,
    licenses,
    motivation_note: motivationNote,
    personal_requests: clamp(str(pii.preferences), 1000),
  };
  return saveResumeRequestSchema.parse(req);
}

/**
 * 職務経歴書ドラフト payload → 求職者職務経歴書 SaveCvRequest(best-effort)。
 * agency の自由文 body は構造化できないため summary / self_pr にクランプして写す。
 */
export function agencyCvPayloadToSaveRequest(
  payload: DocumentDraftPayload,
  title: string,
): SaveCvRequest {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const req = {
    title: clamp(title || "職務経歴書", 100),
    document_date: "",
    body: {
      summary: clamp(str(data.summary), 1500),
      work_experiences: [],
      skills: [],
      // agency の自由文 body は seeker の構造化項目に収まらないため self_pr に退避
      // (受領後に本人が work_experiences 等へ整形する前提)。
      self_pr: clamp(str(data.body), 2000),
    },
  };
  return saveCvRequestSchema.parse(req);
}
