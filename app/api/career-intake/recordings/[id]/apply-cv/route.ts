import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { getMyRecording } from "@/lib/career-intake/queries";
import { applyToCvSchema } from "@/lib/career-intake/types";
import { createCv, getCv, updateCv } from "@/lib/cvs/queries";
import { emptyCvBody, type Skill, type WorkExperience } from "@/lib/cvs/types";

/**
 * POST /api/career-intake/recordings/[id]/apply-cv
 *
 * - targetCvId なし:新規作成
 * - targetCvId あり:既存にマージ
 *   - 配列(work_experiences、skills):重複除外して追記
 *   - 自由テキスト(summary, self_pr):既存が空のときだけ抽出値で埋める
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // 空 body OK
  }
  const parsed = applyToCvSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rec = await getMyRecording(id);
  if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  if (rec.status !== "extracted" || !rec.extraction) {
    return NextResponse.json(
      { error: "抽出が完了していないため、職務経歴書を作成できません" },
      { status: 409 },
    );
  }

  const ext = rec.extraction;

  const extractedWorks: WorkExperience[] = ext.workExperiences.map((w) => ({
    company_name: w.companyName,
    industry: w.industry ?? null,
    position: w.position ?? null,
    period_start:
      w.startYear != null && w.startMonth != null
        ? { year: w.startYear, month: w.startMonth }
        : null,
    period_end:
      w.endYear != null && w.endMonth != null ? { year: w.endYear, month: w.endMonth } : null,
    employment_type: null,
    job_description: w.jobDescription ?? "",
    achievements: w.achievements ?? "",
  }));

  const extractedSkills: Skill[] = ext.skills.map((s) => ({
    category: s.category,
    name: s.name,
    level: s.level ?? null,
    description: null,
  }));

  // 既存への追記モード
  if (parsed.data.targetCvId) {
    const existing = await getCv(parsed.data.targetCvId, user.id);
    if (!existing) {
      return NextResponse.json({ error: "Target CV not found" }, { status: 404 });
    }
    const mergedWorks = mergeWorkExperiences(existing.body.work_experiences, extractedWorks);
    const mergedSkills = mergeSkills(existing.body.skills, extractedSkills);
    await updateCv(parsed.data.targetCvId, user.id, {
      title: existing.title,
      document_date: existing.documentDate ?? "",
      license_resume_id: existing.licenseResumeId ?? null,
      body: {
        summary:
          existing.body.summary && existing.body.summary.trim() !== ""
            ? existing.body.summary
            : (ext.careerSummary ?? ""),
        self_pr:
          existing.body.self_pr && existing.body.self_pr.trim() !== ""
            ? existing.body.self_pr
            : (ext.selfPr ?? ""),
        work_experiences: mergedWorks,
        skills: mergedSkills,
      },
    });
    return NextResponse.json({ cvId: parsed.data.targetCvId, merged: true });
  }

  // 新規作成モード
  const empty = emptyCvBody();
  const newCvId = await createCv(user.id, {
    title: parsed.data.targetTitle,
    document_date: "",
    license_resume_id: null,
    body: {
      ...empty,
      summary: ext.careerSummary ?? "",
      self_pr: ext.selfPr ?? "",
      work_experiences: extractedWorks,
      skills: extractedSkills,
    },
  });

  return NextResponse.json({ cvId: newCvId, merged: false });
}

/** company_name が完全一致する WorkExperience は重複と見なして除外 */
function mergeWorkExperiences(
  existing: WorkExperience[],
  added: WorkExperience[],
): WorkExperience[] {
  const names = new Set(existing.map((w) => w.company_name.trim()).filter(Boolean));
  const additions = added.filter((w) => {
    const n = w.company_name.trim();
    return n !== "" && !names.has(n);
  });
  return [...existing, ...additions];
}

/** category + name の組み合わせが完全一致する Skill は重複と見なして除外 */
function mergeSkills(existing: Skill[], added: Skill[]): Skill[] {
  const key = (s: Skill) => `${s.category}:${s.name.trim().toLowerCase()}`;
  const existingKeys = new Set(existing.map(key));
  const additions = added.filter((s) => s.name.trim() !== "" && !existingKeys.has(key(s)));
  return [...existing, ...additions];
}
