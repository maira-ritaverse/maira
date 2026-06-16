import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { getMyRecording } from "@/lib/career-intake/queries";
import { applyToResumeSchema } from "@/lib/career-intake/types";
import { createResume, getResume, updateResume } from "@/lib/resumes/queries";
import type { EducationItem, LicenseItem } from "@/lib/resumes/types";

/**
 * POST /api/career-intake/recordings/[id]/apply
 *
 * 抽出済みの録音から履歴書を作成 / 既存に追記する。
 * - targetResumeId なし:新規作成
 * - targetResumeId あり:既存履歴書にマージ
 *   - 配列(教育・職歴・資格)は重複除外して追記
 *   - 自由テキスト(志望動機メモ)は既存が空のときだけ抽出値で埋める
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
  const parsed = applyToResumeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rec = await getMyRecording(id);
  if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  if (rec.status !== "extracted" || !rec.extraction) {
    return NextResponse.json(
      { error: "抽出が完了していないため、履歴書を作成できません" },
      { status: 409 },
    );
  }

  const ext = rec.extraction;
  const extractedHistory: EducationItem[] = [...ext.educationHistory, ...ext.workHistory];
  const extractedLicenses: LicenseItem[] = ext.licenses;

  // 既存履歴書への追記モード
  if (parsed.data.targetResumeId) {
    const existing = await getResume(parsed.data.targetResumeId, user.id);
    if (!existing) {
      return NextResponse.json({ error: "Target resume not found" }, { status: 404 });
    }
    const mergedHistory = mergeEducationItems(existing.educationHistory, extractedHistory);
    const mergedLicenses = mergeLicenseItems(existing.licenses, extractedLicenses);
    await updateResume(parsed.data.targetResumeId, user.id, {
      title: existing.title,
      name: existing.name ?? "",
      name_kana: existing.nameKana ?? ext.nameKana ?? "",
      birth_date: existing.birthDate ?? ext.birthDate ?? "",
      gender: existing.gender ?? null,
      postal_code: existing.postalCode ?? "",
      address: existing.address ?? "",
      address_kana: existing.addressKana ?? "",
      phone: existing.phone ?? "",
      email: existing.email ?? "",
      contact_address: existing.contactAddress ?? "",
      contact_address_kana: existing.contactAddressKana ?? "",
      contact_phone: existing.contactPhone ?? "",
      document_date: existing.documentDate ?? "",
      education_history: mergedHistory,
      licenses: mergedLicenses,
      // 自由テキスト:既存が空のときだけ抽出値で埋める
      motivation_note:
        existing.motivationNote && existing.motivationNote.trim() !== ""
          ? existing.motivationNote
          : (ext.motivationNote ?? ""),
      personal_requests: existing.personalRequests ?? "",
    });
    return NextResponse.json({ resumeId: parsed.data.targetResumeId, merged: true });
  }

  // 新規作成モード
  const newResumeId = await createResume(user.id, {
    title: parsed.data.targetTitle,
    name: "",
    name_kana: ext.nameKana ?? "",
    birth_date: ext.birthDate ?? "",
    gender: null,
    postal_code: "",
    address: "",
    address_kana: "",
    phone: "",
    email: "",
    contact_address: "",
    contact_address_kana: "",
    contact_phone: "",
    document_date: "",
    education_history: extractedHistory,
    licenses: extractedLicenses,
    motivation_note: ext.motivationNote ?? "",
    personal_requests: "",
  });

  return NextResponse.json({ resumeId: newResumeId, merged: false });
}

/** description が完全一致する EducationItem は重複と見なして除外 */
function mergeEducationItems(existing: EducationItem[], added: EducationItem[]): EducationItem[] {
  const existingDescs = new Set(existing.map((e) => e.description.trim()).filter(Boolean));
  const additions = added.filter((e) => {
    const d = e.description.trim();
    return d !== "" && !existingDescs.has(d);
  });
  return [...existing, ...additions];
}

/** name が完全一致する LicenseItem は重複と見なして除外 */
function mergeLicenseItems(existing: LicenseItem[], added: LicenseItem[]): LicenseItem[] {
  const existingNames = new Set(existing.map((l) => l.name.trim()).filter(Boolean));
  const additions = added.filter((l) => {
    const n = l.name.trim();
    return n !== "" && !existingNames.has(n);
  });
  return [...existing, ...additions];
}
