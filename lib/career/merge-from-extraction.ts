/**
 * エージェント面談の AI 抽出結果(ExtractionResult)を
 * 本人のキャリア棚卸し(CareerProfile)に「安全にマージ」する純関数。
 *
 * 方針:
 *   ・本人が既に入れている情報は上書きしない(エージェントの解釈で書き換えない)
 *   ・本人が空欄/未入力のフィールドだけ追加する
 *   ・希望条件(industries / role_types)は union(重複除外)で追加
 *   ・user_facts は null のフィールドのみ埋める
 *   ・strengths / values / concerns には触らない(本人の言葉で記述すべき領域)
 *   ・summary は既存が空のときだけ careerSummary で初期化
 *
 * 純関数。テストしやすいよう外部依存を持たない。
 */
import type { ExtractionResult } from "@/lib/career-intake/types";
import type { CareerProfile } from "@/lib/career/profile-schema";

/** strings を case-insensitive trim で正規化して union 集合に追加 */
function unionStrings(base: ReadonlyArray<string>, add: ReadonlyArray<string>): string[] {
  const map = new Map<string, string>();
  for (const v of base) {
    const k = v.trim().toLowerCase();
    if (k) map.set(k, v);
  }
  for (const v of add) {
    const k = v.trim().toLowerCase();
    if (k && !map.has(k)) map.set(k, v);
  }
  return Array.from(map.values());
}

export type MergePreview = {
  /** 何が変わったか(UI 表示用)*/
  changedFields: string[];
};

export function mergeExtractionIntoProfile(
  base: CareerProfile,
  extraction: ExtractionResult,
): { profile: CareerProfile; preview: MergePreview } {
  const changed: string[] = [];

  // wants.industries / role_types は union 追加
  const nextIndustries = unionStrings(base.wants.industries, extraction.desiredIndustries);
  if (nextIndustries.length !== base.wants.industries.length) {
    changed.push("希望業界");
  }
  const nextRoles = unionStrings(base.wants.role_types, extraction.desiredOccupations);
  if (nextRoles.length !== base.wants.role_types.length) {
    changed.push("希望職種");
  }

  // user_facts は null フィールドのみ埋める
  let nextFacts = base.user_facts;
  const firstExp = extraction.workExperiences[0];
  if (firstExp) {
    if (base.user_facts.current_role === null && firstExp.position) {
      nextFacts = { ...nextFacts, current_role: firstExp.position };
      changed.push("現在の職種");
    }
    if (base.user_facts.industry === null && firstExp.industry) {
      nextFacts = { ...nextFacts, industry: firstExp.industry };
      changed.push("現在の業界");
    }
  }

  // summary は既存が空のときだけ careerSummary で初期化
  let nextSummary = base.summary;
  if ((!base.summary || base.summary.trim() === "") && extraction.careerSummary) {
    nextSummary = extraction.careerSummary;
    changed.push("プロフィール総括");
  }

  const profile: CareerProfile = {
    ...base,
    user_facts: nextFacts,
    wants: {
      ...base.wants,
      industries: nextIndustries,
      role_types: nextRoles,
    },
    summary: nextSummary,
  };

  return { profile, preview: { changedFields: changed } };
}

/**
 * 既存 CareerProfile が無い(初回登録)ユーザに対して、抽出結果から
 * 「最低限のスケルトン CareerProfile」を作る。
 *
 * - strengths / values / concerns は空(本人記述領域)
 * - user_facts は workExperiences の先頭から埋める
 * - summary は careerSummary
 *
 * これも純関数。
 */
export function buildSkeletonFromExtraction(extraction: ExtractionResult): CareerProfile {
  const firstExp = extraction.workExperiences[0];
  return {
    user_facts: {
      current_role: firstExp?.position ?? null,
      years_of_experience: null,
      industry: firstExp?.industry ?? null,
      company_size: null,
    },
    strengths: [],
    values: [],
    wants: {
      industries: extraction.desiredIndustries,
      role_types: extraction.desiredOccupations,
      company_sizes: [],
    },
    concerns: [],
    summary: extraction.careerSummary ?? extraction.selfPr ?? "",
  };
}
