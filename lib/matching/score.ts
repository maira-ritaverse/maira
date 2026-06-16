/**
 * 顧客 × 求人 のマッチングスコア算出(純関数、副作用ゼロ)
 *
 * 観点:
 *   - 勤務地:client.desired_locations のいずれかが job.location に substring 一致
 *   - 年収:client.desired_annual_income が job.salary_min..salary_max のレンジに収まる
 *   - 職種:client.desired_occupations のいずれかが job.position に substring 一致
 *   - 雇用形態:両方とも値があり完全一致(ラベルベース)
 *
 * 配点(合計 100 点):
 *   - location: 30
 *   - salary:   30
 *   - position: 25
 *   - employment: 15
 *
 * 欠損(未入力)はスコアに反映しない(減点もしない)。
 * 例:client.desired_annual_income が null → salary 観点はスキップ(0/0 で減点 0)。
 *
 * 業務上の方針:
 *   - スコアは「強く相関する求人」を上に並べるためのヒント。確定マッチではない。
 *   - 同点が並ぶ場合は最新更新順を後段で安定ソートする(本関数では関与しない)。
 */

export type MatchClientInput = {
  desiredLocations: string[];
  desiredOccupations: string[];
  desiredAnnualIncome: number | null;
  currentEmploymentType: string | null;
};

export type MatchJobInput = {
  id: string;
  companyName: string;
  position: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  employmentType: string | null;
};

export type MatchReason = "location" | "salary" | "position" | "employment";

export type MatchResult = {
  jobId: string;
  score: number; // 0 - 100
  reasons: MatchReason[];
};

const POINTS: Record<MatchReason, number> = {
  location: 30,
  salary: 30,
  position: 25,
  employment: 15,
};

/** 半角 / 全角を正規化してから lower-case(日本語の部分一致を頑健に) */
function normalize(s: string): string {
  return s.trim().normalize("NFKC").toLowerCase();
}

/** 任意のキーワード配列が target に部分一致するかチェック(空配列は false) */
function anyKeywordIn(keywords: string[], target: string | null): boolean {
  if (!target) return false;
  const t = normalize(target);
  if (t === "") return false;
  for (const k of keywords) {
    const kn = normalize(k);
    if (kn !== "" && t.includes(kn)) return true;
  }
  return false;
}

/** 年収レンジに値が収まるか(min/max のどちらか欠損は緩く解釈) */
function salaryFits(target: number, min: number | null, max: number | null): boolean {
  if (min !== null && target < min) return false;
  if (max !== null && target > max) return false;
  return true;
}

/**
 * 1 顧客 × 1 求人のスコア計算。0 点でも reasons は空のまま返す
 * (呼び出し側で「0 点は出さない」等のフィルタが書きやすいように)。
 */
export function scoreMatch(client: MatchClientInput, job: MatchJobInput): MatchResult {
  let score = 0;
  const reasons: MatchReason[] = [];

  if (anyKeywordIn(client.desiredLocations, job.location)) {
    score += POINTS.location;
    reasons.push("location");
  }

  if (
    client.desiredAnnualIncome !== null &&
    (job.salaryMin !== null || job.salaryMax !== null) &&
    salaryFits(client.desiredAnnualIncome, job.salaryMin, job.salaryMax)
  ) {
    score += POINTS.salary;
    reasons.push("salary");
  }

  if (anyKeywordIn(client.desiredOccupations, job.position)) {
    score += POINTS.position;
    reasons.push("position");
  }

  if (
    client.currentEmploymentType &&
    job.employmentType &&
    normalize(client.currentEmploymentType) === normalize(job.employmentType)
  ) {
    score += POINTS.employment;
    reasons.push("employment");
  }

  return { jobId: job.id, score, reasons };
}

/**
 * 顧客に対して N 件のトップマッチを返す(降順 + 同点はスコア計算結果の入力順を維持)。
 * 既に応募済み(referrals)の jobId を引数で渡せば除外できる。
 */
export function rankMatches(
  client: MatchClientInput,
  jobs: ReadonlyArray<MatchJobInput>,
  options: { topN?: number; excludeJobIds?: ReadonlySet<string>; minScore?: number } = {},
): MatchResult[] {
  const topN = options.topN ?? 5;
  const minScore = options.minScore ?? 1;
  const excludeJobIds = options.excludeJobIds ?? new Set<string>();

  const results: MatchResult[] = [];
  for (const job of jobs) {
    if (excludeJobIds.has(job.id)) continue;
    const r = scoreMatch(client, job);
    if (r.score < minScore) continue;
    results.push(r);
  }
  // 降順 + 安定ソート(同点は最初に出てきた順を維持するため Array.prototype.sort の
  // 安定性に頼る:Node v12+ では保証されている)
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}
