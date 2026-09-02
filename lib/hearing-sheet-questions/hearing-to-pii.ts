/**
 * ヒアリングシートの回答から、エージェントのクライアント履歴書の本人情報(ResumePii)を
 * 埋めるためのマッピング(②B)。
 *
 * 質問定義の maps_to_pii が設定されている項目だけを対象に、回答文字列を対応する
 * ResumePii キーへ流し込む。生年月日・性別は自由記述からの best-effort 変換で、
 * 解釈できない場合はその項目をスキップする(誤った値を入れない)。文字列項目は
 * ResumePii 側の最大長にクランプする。
 */
import type { HearingSheetContent, ResumePii } from "@/lib/agency-client-documents/types";

import type { HearingPiiTarget, HearingQuestionDefinition } from "./types";

/** 文字列系 PII ターゲットの最大長(resumePiiSchema と一致)。 */
const STRING_PII_MAX: Record<Exclude<HearingPiiTarget, "gender" | "birth_date">, number> = {
  full_name: 100,
  full_name_kana: 100,
  postal_code: 10,
  address: 300,
  address_kana: 200,
  phone: 20,
  email: 254,
  motivation: 2000,
  self_pr: 2000,
  preferences: 1000,
};

/**
 * 自由記述の生年月日を "YYYY-MM-DD" に正規化。
 * 対応:2000-01-02 / 2000/1/2 / 2000年1月2日 など。解釈不能なら null。
 */
function normalizeBirthDate(raw: string): string | null {
  const m = raw.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const yearN = Number(y);
  const monthN = Number(mo);
  const dayN = Number(d);
  if (monthN < 1 || monthN > 12 || dayN < 1 || dayN > 31) return null;
  // 実在する暦日かを検証する(2000-02-31 / 2000-04-31 などの不正日を弾く)。
  const dt = new Date(Date.UTC(yearN, monthN - 1, dayN));
  if (
    dt.getUTCFullYear() !== yearN ||
    dt.getUTCMonth() + 1 !== monthN ||
    dt.getUTCDate() !== dayN
  ) {
    return null;
  }
  return `${y}-${String(monthN).padStart(2, "0")}-${String(dayN).padStart(2, "0")}`;
}

/**
 * 自由記述の性別を ResumePii の enum に best-effort 変換。
 * 「女性」を含む or 完全一致「女」→female /「男性」を含む or 完全一致「男」→male /
 * 「その他 / other」→other。判定不能なら null。
 *
 * 「女」「男」の部分一致は使わない(「長女」「彼女」「男女比」等の誤判定を避けるため、
 * 完全一致 or 「女性 / 男性」という語での判定に限定する)。
 */
function normalizeGender(raw: string): ResumePii["gender"] | null {
  const s = raw.trim();
  if (/女性/.test(s) || s === "女" || /^female$/i.test(s)) return "female";
  if (/男性/.test(s) || s === "男" || /^male$/i.test(s)) return "male";
  if (/その他/.test(s) || /^other$/i.test(s)) return "other";
  return null;
}

/**
 * ヒアリング回答 → ResumePii の部分パッチを作る。
 * count は「実際に値が入った ResumePii 項目数」(= patch のキー数)。複数の質問が
 * 同じ maps_to_pii を指していても、最終的に埋まる項目数で数える(水増ししない)。
 */
export function hearingSheetToResumePii(
  questions: HearingQuestionDefinition[],
  content: HearingSheetContent | null,
): { patch: Partial<ResumePii>; count: number } {
  if (!content) return { patch: {}, count: 0 };

  const patch: Partial<ResumePii> = {};

  for (const q of questions) {
    if (!q.mapsToPii) continue;
    const raw = (content[q.key] ?? "").trim();
    if (raw.length === 0) continue;

    const target = q.mapsToPii;
    if (target === "gender") {
      const g = normalizeGender(raw);
      if (g) patch.gender = g;
    } else if (target === "birth_date") {
      const d = normalizeBirthDate(raw);
      if (d) patch.birth_date = d;
    } else {
      // 文字列系:最大長でクランプして流し込む
      patch[target] = raw.slice(0, STRING_PII_MAX[target]);
    }
  }

  return { patch, count: Object.keys(patch).length };
}
