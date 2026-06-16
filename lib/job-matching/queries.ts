/**
 * AI 求人推薦のキャッシュ取得 / 保存 + Claude 呼び出し統合
 *
 * - サーバ側のみで動く(career_profile を復号するため)
 * - 結果(score + rationale)は AES-256-GCM 暗号化して保存
 * - 入力ハッシュが一致するキャッシュがあればそれを返す
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

export type CachedRecommendation = {
  ranking: AiRanking;
  generatedAt: string;
  inputsHash: string;
  isFresh: boolean;
};

type CacheRow = {
  encrypted_rankings: string;
  inputs_hash: string;
  generated_at: string;
};

type ClientRow = {
  id: string;
  organization_id: string;
  updated_at: string;
  desired_annual_income: number | null;
  desired_locations: string[] | null;
};

/**
 * 「現在キャッシュされている AI 推薦」を返す(なければ null)。
 * isFresh は「入力ハッシュが現在の入力と一致するか」。
 */
export async function getCachedRecommendation(args: {
  clientRecordId: string;
  currentInputsHash: string;
}): Promise<CachedRecommendation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_job_ai_recommendations")
    .select("encrypted_rankings, inputs_hash, generated_at")
    .eq("client_record_id", args.clientRecordId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as CacheRow;
  const decrypted = await decryptField(row.encrypted_rankings);
  if (!decrypted) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    return null;
  }
  const validated = aiRankingSchema.safeParse(parsed);
  if (!validated.success) return null;
  return {
    ranking: validated.data,
    generatedAt: row.generated_at,
    inputsHash: row.inputs_hash,
    isFresh: row.inputs_hash === args.currentInputsHash,
  };
}

/**
 * Claude を呼んで AI ランキングを生成し、キャッシュに upsert する。
 */
export async function recomputeAndCacheRecommendation(args: {
  client: ClientRow;
  jobs: JobPosting[];
}): Promise<AiRanking> {
  const supabase = await createClient();

  // 1) career_profile 取得(linked クライアントのみ)
  const { data: encrypted } = await supabase.rpc("get_linked_client_encrypted_career_profile", {
    p_client_record_id: args.client.id,
  });
  const profile =
    typeof encrypted === "string" && encrypted.length > 0
      ? await decodeCareerProfileBlob(encrypted)
      : null;

  // 2) プロンプト構築
  const ctx = buildClientContextFromProfile(profile, {
    desired_annual_income: args.client.desired_annual_income,
    desired_locations: args.client.desired_locations,
  });
  const prompt = buildPrompt({ client: ctx, jobs: args.jobs });

  // 3) Claude 呼び出し
  const completion = await generateText({
    model: getModel(MODELS.CONVERSATION),
    system:
      "あなたは日本の転職市場に精通したキャリアアドバイザーです。出力は厳密に指定 JSON 形式のみ。前置きや結びの言葉は禁止。",
    prompt,
  });
  const jsonText = extractJsonFromText(completion.text.trim());
  const parsed = JSON.parse(jsonText) as unknown;
  const validated = aiRankingSchema.parse(parsed);

  // 4) 求人 ID の整合チェック(LLM が捏造した ID を弾く)
  const validIds = new Set(args.jobs.map((j) => j.id));
  const items = validated.items.filter((i) => validIds.has(i.job_posting_id)).slice(0, 5);
  const ranking: AiRanking = { items };

  // 5) hash 再計算 + upsert
  const inputsHash = computeInputsHash({
    careerProfileUpdatedAt: null, // 復号データから直接取れないため null 固定(他要素で差分検出)
    clientUpdatedAt: args.client.updated_at,
    jobs: args.jobs.map((j) => ({ id: j.id, updated_at: j.updatedAt })),
  });

  const encryptedRankings = await encryptField(JSON.stringify(ranking));
  if (!encryptedRankings) throw new Error("ranking 暗号化失敗");

  await supabase.from("client_job_ai_recommendations").upsert(
    {
      organization_id: args.client.organization_id,
      client_record_id: args.client.id,
      encrypted_rankings: encryptedRankings,
      inputs_hash: inputsHash,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "client_record_id" },
  );

  return ranking;
}

/**
 * 現在の入力ハッシュを計算するヘルパ(API 側でキャッシュ判定に使う)。
 */
export function computeCurrentInputsHash(args: { client: ClientRow; jobs: JobPosting[] }): string {
  return computeInputsHash({
    careerProfileUpdatedAt: null,
    clientUpdatedAt: args.client.updated_at,
    jobs: args.jobs.map((j) => ({ id: j.id, updated_at: j.updatedAt })),
  });
}
