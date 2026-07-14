/**
 * 自然文検索 (Tier 4) の Claude 呼び出し + キャッシュ層。
 *
 * 副作用ゼロの純関数 (normalizeQuery / hashQuery / buildJobsPrompt / buildClientsPrompt)
 * と、Supabase + Claude を呼ぶ非同期関数 (parseJobsQuery / parseClientsQuery) を分けて
 * export する。純関数はテスト対象。
 *
 * キャッシュ:
 *   (organization_id, resource, query_hash) の複合 PK で 24h TTL。
 *   ヒット時は Claude を呼ばない。write は service_role 経由。
 */

import { createHash } from "node:crypto";

import { generateObject } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";
import { createServiceClient } from "@/lib/supabase/service";
import {
  type ClientSearchFilters,
  type JobSearchFilters,
  clientSearchFiltersSchema,
  jobSearchFiltersSchema,
} from "./nl-parse-schema";

const CACHE_TTL_SEC = 24 * 60 * 60; // 24h

// ─── 純関数 ─────────────────────────────────────

/**
 * クエリ正規化: NFKC + 小文字化 + 前後空白除去 + 連続空白を単一空白に。
 * キャッシュキー作成と AI 入力の両方で使う (同一意味の重複ヒットを潰す)。
 */
export function normalizeQuery(raw: string): string {
  return raw.trim().normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
}

/**
 * 正規化済みクエリの SHA-256 hex 先頭 32 文字を返す。
 * 128bit 相当あればキャッシュキーの衝突は事実上ゼロ。
 */
export function hashQuery(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

// ─── 語彙集約 ────────────────────────────────

export type JobVocabulary = {
  locations: string[]; // 実在する勤務地文字列 (件数降順)
  companyNames: string[]; // 上位 20 件
  employmentTypes: string[]; // 実在する雇用形態
};

export type ClientVocabulary = {
  entrySites: string[]; // 実在するエントリー元
  prefectures: string[]; // 実在する都道府県
  crmTags: string[]; // 実在する CRM タグ
};

/**
 * 組織内の求人から自然文パースの補助語彙を集める。
 * AI に「この組織で実在する値だけを使え」と示すことでハルシネーションを抑える。
 */
export async function collectJobVocabulary(organizationId: string): Promise<JobVocabulary> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("job_postings")
    .select("company_name, location, employment_type")
    .eq("organization_id", organizationId)
    .limit(500);

  const rows = (data ?? []) as Array<{
    company_name: string | null;
    location: string | null;
    employment_type: string | null;
  }>;

  return {
    locations: uniqueTopN(
      rows.map((r) => r.location),
      30,
    ),
    companyNames: uniqueTopN(
      rows.map((r) => r.company_name),
      20,
    ),
    employmentTypes: uniqueTopN(
      rows.map((r) => r.employment_type),
      15,
    ),
  };
}

/**
 * 組織内のクライアント一覧から自然文パースの補助語彙を集める。
 */
export async function collectClientVocabulary(organizationId: string): Promise<ClientVocabulary> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("client_records")
    .select("entry_site, prefecture, crm_tags")
    .eq("organization_id", organizationId)
    .limit(2000);

  const rows = (data ?? []) as Array<{
    entry_site: string | null;
    prefecture: string | null;
    crm_tags: string[] | null;
  }>;

  const tagFlat = rows.flatMap((r) => r.crm_tags ?? []);
  return {
    entrySites: uniqueTopN(
      rows.map((r) => r.entry_site),
      30,
    ),
    prefectures: uniqueTopN(
      rows.map((r) => r.prefecture),
      50,
    ),
    crmTags: uniqueTopN(tagFlat, 40),
  };
}

function uniqueTopN(values: (string | null | undefined)[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v || v.trim() === "") continue;
    const key = v.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// ─── プロンプト構築 ─────────────────────────────

export function buildJobsPrompt(query: string, vocab: JobVocabulary) {
  const system = [
    "あなたは求人検索クエリのパーサです。",
    "ユーザーの自然文を、JSON スキーマに従った構造化フィルタに変換してください。",
    "",
    "重要な規則:",
    "- 年収は「万円単位の整数」です。「500 万円以上」→ minSalary=500、「1000万円以下」→ maxSalary=1000。",
    "- 「300 万」など単位が省略されていても 「万円」 として解釈してください (国内相場の常識)。",
    "- statusFilter は「募集中」「停止中」「終了」のいずれかがユーザー入力に明示された時のみ設定。",
    "  明示されていなければ必ず 'all' にしてください (勝手に募集中で絞らない)。",
    "- 「リモート」「在宅」「フルリモート」は locationKeyword に「リモート」を入れる。",
    "- 「東京」「大阪」等の勤務地名は locationKeyword に入れる (locationKeyword は 1 つだけ)。",
    "- 職種名 (例: Web エンジニア / 営業 / デザイナー) は searchQuery に入れる。",
    "- 会社名の部分もあれば searchQuery に含めて構いません。",
    "- 「英語できる」「TypeScript 経験」など、上記に当てはまらないスキルや条件は searchQuery に残す。",
    "- どのフィールドにも入らなかった語は remainingText に入れる。",
    "- 全体を解釈できた自信があれば confidence='high'、推測が入ったら 'low' を返す。",
    "",
    "この組織で実在する参考語彙 (この中の表記に揃えるとヒット率が上がります):",
    vocab.locations.length > 0 ? `- 勤務地: ${vocab.locations.slice(0, 20).join(", ")}` : "",
    vocab.employmentTypes.length > 0 ? `- 雇用形態: ${vocab.employmentTypes.join(", ")}` : "",
    vocab.companyNames.length > 0 ? `- 会社名: ${vocab.companyNames.join(", ")}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  return { system, prompt: `ユーザー入力: ${query}` };
}

export function buildClientsPrompt(query: string, vocab: ClientVocabulary) {
  const system = [
    "あなたはエージェント向けクライアント検索クエリのパーサです。",
    "ユーザーの自然文を、JSON スキーマに従った構造化フィルタに変換してください。",
    "",
    "重要な規則:",
    "- statusFilter は次のいずれかを取ります (明示なければ 'all'):",
    "  initial_meeting=初回面談 / job_matching=求人紹介中 / in_screening=選考中(面接待ちを含む) /",
    "  offer=内定 / completed=転職完了 / declined=見送り",
    "- employmentTypeFilter は full_time=正社員 / contract=契約社員 / temporary=派遣 /",
    "  part_time=アルバイト / business_outsource=業務委託 / self_employed=フリーランス /",
    "  unemployed=離職中 / student=学生 / other=その他 / unset=未設定 / all=絞らない。",
    "- silenceFilter は '14d' / '30d' / '60d' / '90d' / 'never' / 'all'。",
    "  「30 日以上放置」「1 ヶ月連絡なし」→ '30d'、「一度も対応していない」→ 'never'。",
    "- prefectureFilter は都道府県名 (例: 「東京」→ 「東京都」)。関東など複数県のときは 'all' に落とし、",
    "  かわりに searchQuery に「東京 神奈川」等のキーワードを入れる (単一しか指定できないため)。",
    "- entrySiteFilter はエントリー元 (媒体名)。'all'/'unset' 特殊値対応。",
    "- tagFilter は CRM タグ (AND 条件、複数指定可)。組織内の実在タグに一致させる。",
    "- 職種・スキル・年齢帯・自由文条件などは searchQuery に残す。",
    "- どのフィールドにも入らなかった語は remainingText に入れる。",
    "",
    "この組織で実在する参考語彙 (この中の表記に揃えるとヒット率が上がります):",
    vocab.prefectures.length > 0 ? `- 都道府県: ${vocab.prefectures.join(", ")}` : "",
    vocab.entrySites.length > 0 ? `- エントリー元: ${vocab.entrySites.join(", ")}` : "",
    vocab.crmTags.length > 0 ? `- CRM タグ: ${vocab.crmTags.join(", ")}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  return { system, prompt: `ユーザー入力: ${query}` };
}

// ─── 後処理: 動的語彙の範囲外を切り詰め ───────────

/**
 * AI が推測で org に存在しない値を返した場合に、それを 'all' や無視に落とす。
 * high 判定でも実在しない値を返すことがあるため必ず後処理する。
 */
export function sanitizeClientFilters(
  parsed: ClientSearchFilters,
  vocab: ClientVocabulary,
): ClientSearchFilters {
  let confidence = parsed.confidence;
  let entrySiteFilter = parsed.entrySiteFilter;
  let prefectureFilter = parsed.prefectureFilter;
  let tagFilter = parsed.tagFilter;
  let remainingText = parsed.remainingText;

  const entrySites = new Set(vocab.entrySites);
  const prefectures = new Set(vocab.prefectures);
  const tags = new Set(vocab.crmTags);

  if (
    entrySiteFilter !== "all" &&
    entrySiteFilter !== "unset" &&
    !entrySites.has(entrySiteFilter)
  ) {
    remainingText = joinText(remainingText, entrySiteFilter);
    entrySiteFilter = "all";
    confidence = "low";
  }
  if (
    prefectureFilter !== "all" &&
    prefectureFilter !== "unset" &&
    !prefectures.has(prefectureFilter)
  ) {
    remainingText = joinText(remainingText, prefectureFilter);
    prefectureFilter = "all";
    confidence = "low";
  }
  const originalTagCount = tagFilter.length;
  tagFilter = tagFilter.filter((t) => tags.has(t));
  if (tagFilter.length < originalTagCount) confidence = "low";

  return {
    ...parsed,
    entrySiteFilter,
    prefectureFilter,
    tagFilter,
    remainingText,
    confidence,
  };
}

function joinText(existing: string, extra: string): string {
  if (!extra) return existing;
  return existing.length === 0 ? extra : `${existing} ${extra}`;
}

// ─── AI 呼び出し (公開 API) ─────────────────────

export type NlParseCacheHit<T> = { source: "cache"; filters: T; model: string };
export type NlParseAiHit<T> = { source: "ai"; filters: T; model: string };
export type NlParseFailure = { source: "error"; message: string };
export type NlParseResult<T> = NlParseCacheHit<T> | NlParseAiHit<T> | NlParseFailure;

const MODEL_ID = MODELS.LIGHT;

export async function parseJobsQuery(input: {
  organizationId: string;
  query: string;
}): Promise<NlParseResult<JobSearchFilters>> {
  return parseGeneric({
    organizationId: input.organizationId,
    query: input.query,
    resource: "jobs",
    fetchVocab: () => collectJobVocabulary(input.organizationId),
    buildPrompt: (q, v) => buildJobsPrompt(q, v),
    schema: jobSearchFiltersSchema,
    sanitize: (parsed) => parsed,
  });
}

export async function parseClientsQuery(input: {
  organizationId: string;
  query: string;
}): Promise<NlParseResult<ClientSearchFilters>> {
  return parseGeneric<ClientSearchFilters, ClientVocabulary>({
    organizationId: input.organizationId,
    query: input.query,
    resource: "clients",
    fetchVocab: () => collectClientVocabulary(input.organizationId),
    buildPrompt: (q, v) => buildClientsPrompt(q, v),
    schema: clientSearchFiltersSchema,
    sanitize: sanitizeClientFilters,
  });
}

type GenericInput<TFilters, TVocab> = {
  organizationId: string;
  query: string;
  resource: "jobs" | "clients";
  fetchVocab: () => Promise<TVocab>;
  buildPrompt: (q: string, v: TVocab) => { system: string; prompt: string };
  schema: typeof jobSearchFiltersSchema | typeof clientSearchFiltersSchema;
  sanitize: (parsed: TFilters, vocab: TVocab) => TFilters;
};

async function parseGeneric<TFilters, TVocab>(
  input: GenericInput<TFilters, TVocab>,
): Promise<NlParseResult<TFilters>> {
  const normalized = normalizeQuery(input.query);
  if (normalized.length === 0) {
    return { source: "error", message: "クエリが空です" };
  }
  const queryHash = hashQuery(normalized);

  // 1) キャッシュ read
  const cached = await readCache<TFilters>({
    organizationId: input.organizationId,
    resource: input.resource,
    queryHash,
  });
  if (cached) {
    return { source: "cache", filters: cached.filters, model: cached.model };
  }

  // 2) 語彙取得 + Claude 呼び出し
  let vocab: TVocab;
  try {
    vocab = await input.fetchVocab();
  } catch (err) {
    return {
      source: "error",
      message: `語彙取得に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { system, prompt } = input.buildPrompt(normalized, vocab);

  let aiObject: unknown;
  try {
    const result = await generateObject({
      model: getModel(MODEL_ID),
      schema: input.schema,
      system,
      prompt,
    });
    aiObject = result.object;
  } catch (err) {
    return {
      source: "error",
      message: `AI 呼び出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const filters = input.sanitize(aiObject as TFilters, vocab);

  // 3) キャッシュ write (失敗しても致命ではないので await するが例外を握りつぶす)
  await writeCache({
    organizationId: input.organizationId,
    resource: input.resource,
    queryHash,
    queryText: normalized,
    filters,
    model: MODEL_ID,
  }).catch(() => {
    // 書き込み失敗は握りつぶす (次回同じクエリで再度 AI を呼ぶだけ)
  });

  return { source: "ai", filters, model: MODEL_ID };
}

// ─── キャッシュ操作 (service role) ──────────────

type CacheRow<T> = {
  filters_json: T;
  remaining_text: string;
  confidence: "high" | "low";
  model: string;
  expires_at: string;
};

async function readCache<T>(input: {
  organizationId: string;
  resource: "jobs" | "clients";
  queryHash: string;
}): Promise<{ filters: T; model: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("nl_search_cache")
    .select("filters_json, remaining_text, confidence, model, expires_at")
    .eq("organization_id", input.organizationId)
    .eq("resource", input.resource)
    .eq("query_hash", input.queryHash)
    .maybeSingle();
  if (!data) return null;
  const row = data as CacheRow<T>;
  // TTL 判定 (期限切れは無視 = 再パース)
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { filters: row.filters_json, model: row.model };
}

async function writeCache<T>(input: {
  organizationId: string;
  resource: "jobs" | "clients";
  queryHash: string;
  queryText: string;
  filters: T;
  model: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const expiresAt = new Date(Date.now() + CACHE_TTL_SEC * 1000).toISOString();
  // remainingText / confidence は JobSearchFilters / ClientSearchFilters 両方に含まれる
  // が、TFilters ジェネリックの制約で型上は不可視。安全側で unknown 経由で読み出す。
  const bag = input.filters as unknown as {
    remainingText?: string;
    confidence?: "high" | "low";
  };
  await supabase.from("nl_search_cache").upsert(
    {
      organization_id: input.organizationId,
      resource: input.resource,
      query_hash: input.queryHash,
      query_text: input.queryText,
      filters_json: input.filters,
      remaining_text: bag.remainingText ?? "",
      confidence: bag.confidence ?? "high",
      model: input.model,
      expires_at: expiresAt,
    },
    { onConflict: "organization_id,resource,query_hash" },
  );
}
