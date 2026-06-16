/**
 * 求職者(seeker)視点の AI 求人推薦
 *
 * 連携エージェンシーの open 求人から、自身のキャリア棚卸し + 診断結果を
 * もとに AI で TOP 5 を返す。
 *
 * - 復号 / Claude 呼び出しはサーバのみ
 * - 結果のキャッシュは現状省略(本人ビューは頻度が低い + 計算量も小さい)
 * - 将来クォータ管理を入れる場合は addon と紐づけ
 */
import { generateText } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";
import { decodeCareerProfileBlob } from "@/lib/career/conversations";
import { extractJsonFromText } from "@/lib/career-intake/extract-json";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";
import type { JobPosting } from "@/lib/jobs/types";

import {
  aiRankingSchema,
  buildClientContextFromProfile,
  buildPrompt,
  computeInputsHash,
  type AiRanking,
} from "./score";

type SeekerJobRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  company_name: string;
  job_position: string;
  employment_type: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  description: string | null;
  required_skills: string | null;
  preferred_skills: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type SeekerRecommendedJob = {
  job: JobPosting & { organizationName: string };
  score: number;
  rationale: string;
};

export type SeekerRecommendationResult = {
  items: SeekerRecommendedJob[];
  totalOpenJobs: number;
  cached: boolean;
  generatedAt: string;
};

/**
 * force=true でキャッシュを無視して必ず再計算する。
 */
export async function getSeekerJobRecommendations(
  options: { force?: boolean } = {},
): Promise<SeekerRecommendationResult> {
  const supabase = await createClient();

  // 1) 認証ユーザ取得
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  // 2) RPC で linked 連携先の open 求人を取得
  const { data: rpcRows, error: rpcErr } = await supabase.rpc("list_open_jobs_for_seeker", {
    p_limit: 50,
  });
  if (rpcErr) {
    throw new Error(`list_open_jobs_for_seeker 失敗: ${rpcErr.message}`);
  }
  const rows = (rpcRows ?? []) as SeekerJobRow[];
  if (rows.length === 0) {
    return { items: [], totalOpenJobs: 0, cached: false, generatedAt: new Date().toISOString() };
  }

  // 3) 自身の career_profile を取得 → 復号 + 更新時刻も取得(hash 用)
  const { data: cpRow } = await supabase
    .from("career_profiles")
    .select("encrypted_data_v2, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = cpRow?.encrypted_data_v2
    ? await decodeCareerProfileBlob(cpRow.encrypted_data_v2)
    : null;

  // 3.5) 現在の入力ハッシュ → キャッシュチェック
  const inputsHash = computeInputsHash({
    careerProfileUpdatedAt: cpRow?.updated_at ?? null,
    clientUpdatedAt: user.id, // 求職者本人なので client_record の代わりに user.id を固定値として使う
    jobs: rows.map((r) => ({ id: r.id, updated_at: r.updated_at })),
  });
  if (!options.force) {
    const { data: cacheRow } = await supabase
      .from("seeker_job_recommendations")
      .select("encrypted_rankings, inputs_hash, generated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (cacheRow?.inputs_hash === inputsHash && cacheRow.encrypted_rankings) {
      const decrypted = await decryptField(cacheRow.encrypted_rankings);
      if (decrypted) {
        try {
          const parsed = JSON.parse(decrypted) as unknown;
          const validated = aiRankingSchema.safeParse(parsed);
          if (validated.success) {
            // JobPosting 形にいったん変換してから items を組み立てる
            const jobs = mapRowsToJobs(rows);
            const items = mapItems(validated.data, jobs);
            return {
              items,
              totalOpenJobs: jobs.length,
              cached: true,
              generatedAt: cacheRow.generated_at,
            };
          }
        } catch {
          // パース失敗時は再計算に倒す
        }
      }
    }
  }

  // 4) 求職者本人の希望は client_records 由来ではなく career_profile.wants から取る
  //    desiredAnnualIncome / desiredLocations は client_records 由来なので null 扱い
  const ctx = buildClientContextFromProfile(profile, {
    desired_annual_income: null,
    desired_locations: null,
  });

  // 5) JobPosting 形に変換(UI 表示用)
  const jobs = mapRowsToJobs(rows);

  // 6) Claude 呼び出し
  const prompt = buildPrompt({ client: ctx, jobs });
  const completion = await generateText({
    model: getModel(MODELS.CONVERSATION),
    system:
      "あなたは日本の転職市場に精通したキャリアアドバイザーです。出力は厳密に指定 JSON 形式のみ。前置きや結びの言葉は禁止。",
    prompt,
  });
  const jsonText = extractJsonFromText(completion.text.trim());
  const parsed = JSON.parse(jsonText) as unknown;
  const validated = aiRankingSchema.parse(parsed) as AiRanking;

  // 7) 捏造 ID を弾いて top 5
  const items = mapItems(validated, jobs);

  // 8) キャッシュに upsert
  const encryptedRankings = await encryptField(
    JSON.stringify({ items: validated.items.slice(0, 5) }),
  );
  if (encryptedRankings) {
    await supabase.from("seeker_job_recommendations").upsert(
      {
        user_id: user.id,
        encrypted_rankings: encryptedRankings,
        inputs_hash: inputsHash,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  }

  return {
    items,
    totalOpenJobs: jobs.length,
    cached: false,
    generatedAt: new Date().toISOString(),
  };
}

function mapRowsToJobs(rows: SeekerJobRow[]): Array<JobPosting & { organizationName: string }> {
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    companyName: r.company_name,
    position: r.job_position,
    employmentType: r.employment_type,
    location: r.location,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    description: r.description,
    requiredSkills: r.required_skills,
    preferredSkills: r.preferred_skills,
    status: r.status as JobPosting["status"],
    workChangeScope: null,
    locationChangeScope: null,
    smokingPreventionMeasure: null,
    probationPeriod: null,
    workHours: null,
    breakTime: null,
    holidays: null,
    applicationQualifications: null,
    createdByMemberId: null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

function mapItems(
  ranking: AiRanking,
  jobs: Array<JobPosting & { organizationName: string }>,
): SeekerRecommendedJob[] {
  const validIds = new Set(jobs.map((j) => j.id));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  return ranking.items
    .filter((i) => validIds.has(i.job_posting_id))
    .slice(0, 5)
    .map((i) => ({
      job: jobById.get(i.job_posting_id)!,
      score: i.score,
      rationale: i.rationale,
    }));
}
