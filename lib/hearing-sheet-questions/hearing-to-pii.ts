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
  const month = String(Number(mo)).padStart(2, "0");
  const day = String(Number(d)).padStart(2, "0");
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${month}-${day}`;
}

/**
 * 自由記述の性別を ResumePii の enum に best-effort 変換。
 * 「女(性)」→female /「男(性)」→male /「その他 / other」→other。判定不能なら null。
 */
function normalizeGender(raw: string): ResumePii["gender"] | null {
  const s = raw.trim();
  if (/女/.test(s)) return "female";
  if (/男/.test(s)) return "male";
  if (/その他|other/i.test(s)) return "other";
  return null;
}

/**
 * ヒアリング回答 → ResumePii の部分パッチを作る。
 * count は「実際に値が入った項目数」(0 なら流し込むものが無い)。
 */
export function hearingSheetToResumePii(
  questions: HearingQuestionDefinition[],
  content: HearingSheetContent | null,
): { patch: Partial<ResumePii>; count: number } {
  if (!content) return { patch: {}, count: 0 };

  const patch: Partial<ResumePii> = {};
  let count = 0;

  for (const q of questions) {
    if (!q.mapsToPii) continue;
    const raw = (content[q.key] ?? "").trim();
    if (raw.length === 0) continue;

    const target = q.mapsToPii;
    if (target === "gender") {
      const g = normalizeGender(raw);
      if (g) {
        patch.gender = g;
        count += 1;
      }
    } else if (target === "birth_date") {
      const d = normalizeBirthDate(raw);
      if (d) {
        patch.birth_date = d;
        count += 1;
      }
    } else {
      // 文字列系:最大長でクランプして流し込む
      patch[target] = raw.slice(0, STRING_PII_MAX[target]);
      count += 1;
    }
  }

  return { patch, count };
}
