import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createJobRequestSchema } from "@/lib/jobs/types";

/**
 * POST /api/agency/import/jobs
 *
 * 求人 CSV 一括インポート。フロント側で parseCsvAsObjects 済みの
 * Record<string, string>[] を { rows } で受ける。
 *
 * 列マッピング(日本語ヘッダー固定):
 *   会社名 / 求人企業名 -> company_name [必須]
 *   職種 / ポジション   -> position     [必須]
 *   勤務地             -> location
 *   雇用形態           -> employment_type
 *   年収下限           -> salary_min(数値、万円)
 *   年収上限           -> salary_max
 *   仕事内容 / 業務内容 -> description
 *   必須スキル         -> required_skills
 *   歓迎スキル / 歓迎条件 -> preferred_skills
 *   応募資格           -> application_qualifications
 *   試用期間           -> probation_period
 *   勤務時間           -> work_hours
 *   休憩時間           -> break_time
 *   休日休暇           -> holidays
 *   業務変更範囲       -> work_change_scope
 *   勤務地変更範囲     -> location_change_scope
 *   受動喫煙対策       -> smoking_prevention_measure
 *   ステータス         -> status('open'/'paused'/'closed'。空 → 'open')
 *
 * 制限:200 行 / 8 MiB
 *
 * 重複扱い:
 *   (organization_id, company_name, position) が完全一致する求人があれば「重複」として skip
 *   (誤って同じ求人を二重登録するのを防ぐ。company_name + position 一致は実務的に
 *    同じ案件と見なす緩いルール)
 */

const MAX_ROWS = 200;
const MAX_BYTES = 8 * 1024 * 1024;

const HEADER_ALIASES: Record<string, string[]> = {
  company_name: ["会社名", "求人企業名", "company_name"],
  position: ["職種", "ポジション", "position"],
  location: ["勤務地", "location"],
  employment_type: ["雇用形態", "employment_type"],
  salary_min: ["年収下限", "salary_min"],
  salary_max: ["年収上限", "salary_max"],
  description: ["仕事内容", "業務内容", "description"],
  required_skills: ["必須スキル", "required_skills"],
  preferred_skills: ["歓迎スキル", "歓迎条件", "preferred_skills"],
  application_qualifications: ["応募資格", "application_qualifications"],
  probation_period: ["試用期間", "probation_period"],
  work_hours: ["勤務時間", "work_hours"],
  break_time: ["休憩時間", "break_time"],
  holidays: ["休日休暇", "休日", "holidays"],
  work_change_scope: ["業務変更範囲", "業務内容の変更の範囲", "work_change_scope"],
  location_change_scope: ["勤務地変更範囲", "就業場所の変更の範囲", "location_change_scope"],
  smoking_prevention_measure: ["受動喫煙対策", "smoking_prevention_measure"],
  status: ["ステータス", "status"],
};

function normalizeRow(row: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const v = row[alias];
      if (v !== undefined && v !== "") {
        result[canonical] = v.trim();
        break;
      }
    }
  }
  return result;
}

type ResultRow = {
  rowIndex: number;
  outcome: "created" | "skipped_duplicate" | "error";
  message?: string;
  jobId?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BYTES) {
    return NextResponse.json(
      { error: `CSV が大きすぎます(最大 ${MAX_BYTES / 1024 / 1024} MiB)` },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body shape" }, { status: 400 });
  }
  const rows = (body as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "'rows' must be an array" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ created: 0, skippedDuplicate: 0, errors: 0, results: [] });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `行数が多すぎます(最大 ${MAX_ROWS} 行)` }, { status: 413 });
  }

  // 既存の (company_name, position) を取得して重複検出に使う
  const { data: existingRows } = await supabase
    .from("job_postings")
    .select("company_name, position")
    .eq("organization_id", role.organization.id);
  const existingKeys = new Set<string>();
  if (existingRows) {
    for (const r of existingRows as Array<{ company_name: string; position: string }>) {
      existingKeys.add(`${r.company_name}|||${r.position}`);
    }
  }

  const results: ResultRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const raw = rows[i];
    if (typeof raw !== "object" || raw === null) {
      results.push({ rowIndex, outcome: "error", message: "行がオブジェクト形式ではありません" });
      continue;
    }
    const normalized = normalizeRow(raw as Record<string, string>);

    // 重複チェック
    if (normalized.company_name && normalized.position) {
      const key = `${normalized.company_name}|||${normalized.position}`;
      if (existingKeys.has(key)) {
        results.push({
          rowIndex,
          outcome: "skipped_duplicate",
          message: `${normalized.company_name} / ${normalized.position} は既に登録されています`,
        });
        continue;
      }
    }

    // status は CSV 値を小文字化、未指定なら 'open'
    if (normalized.status) {
      normalized.status = normalized.status.toLowerCase();
    }

    const parsed = createJobRequestSchema.safeParse(normalized);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      results.push({
        rowIndex,
        outcome: "error",
        message: `バリデーション失敗: ${issue.path.join(".")} - ${issue.message}`,
      });
      continue;
    }

    const d = parsed.data;
    const insertRow: Record<string, unknown> = {
      organization_id: role.organization.id,
      created_by_member_id: role.member.id,
      company_name: d.company_name,
      position: d.position,
      employment_type: d.employment_type || null,
      location: d.location || null,
      salary_min: d.salary_min ?? null,
      salary_max: d.salary_max ?? null,
      description: d.description || null,
      required_skills: d.required_skills || null,
      preferred_skills: d.preferred_skills || null,
      status: d.status,
      work_change_scope: d.work_change_scope ?? null,
      location_change_scope: d.location_change_scope ?? null,
      smoking_prevention_measure: d.smoking_prevention_measure ?? null,
      probation_period: d.probation_period ?? null,
      work_hours: d.work_hours ?? null,
      break_time: d.break_time ?? null,
      holidays: d.holidays ?? null,
      application_qualifications: d.application_qualifications ?? null,
    };

    const { data: insertedRow, error } = await supabase
      .from("job_postings")
      .insert(insertRow)
      .select("id")
      .single();

    if (error || !insertedRow) {
      results.push({
        rowIndex,
        outcome: "error",
        message: `DB 書き込み失敗: ${error?.message ?? "Unknown"}`,
      });
      continue;
    }

    existingKeys.add(`${d.company_name}|||${d.position}`);
    results.push({ rowIndex, outcome: "created", jobId: insertedRow.id as string });
  }

  const created = results.filter((r) => r.outcome === "created").length;
  const skippedDuplicate = results.filter((r) => r.outcome === "skipped_duplicate").length;
  const errors = results.filter((r) => r.outcome === "error").length;

  return NextResponse.json({ created, skippedDuplicate, errors, results });
}
