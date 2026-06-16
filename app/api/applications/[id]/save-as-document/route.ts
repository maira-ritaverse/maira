import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { getApplication } from "@/lib/applications/queries";
import {
  applyCvOverrides,
  applyResumeOverrides,
  getApplicationPrCustomization,
} from "@/lib/applications/pr-customizations";
import { createCv, getCv } from "@/lib/cvs/queries";
import { createResume, getResume } from "@/lib/resumes/queries";
import type { Resume, SaveResumeRequest } from "@/lib/resumes/types";

/**
 * POST /api/applications/[id]/save-as-document
 *
 * 応募 1 件分の「PR カスタマイズが反映された履歴書 / 職務経歴書」を、
 * 履歴書(または職務経歴書)一覧に新しいレコードとして保存する。
 *
 * - kind = "resume": 指定した baseResumeId をベースに、自由記述欄に
 *   overrides(motivation_note + self_pr)を反映したコピーを作成
 * - kind = "cv":     指定した baseCvId をベースに、body.self_pr に
 *   overrides.cv_self_pr を反映したコピーを作成
 *
 * タイトル形式:`{会社名}(YYYY-MM-DD)`
 *   - 同じ会社で複数回保存しても日付で区別できる
 *   - 会社名が長い場合は title カラム上限(100 字)に収まるよう短縮
 *
 * 写真:履歴書を複製する場合、ベース履歴書の photo_url を carry-over する
 *   → 両レコードが同じストレージオブジェクトを参照するが、後から片方を上書きしても
 *     もう片方には影響しない(storage 行の参照カウントは持っていないが、object 自体は
 *     resume 行の削除で消えないため、ぶら下がる写真ファイルは発生しても double-free にはならない)。
 */

const saveAsDocumentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resume"), baseResumeId: z.string().uuid() }),
  z.object({ kind: z.literal("cv"), baseCvId: z.string().uuid() }),
]);

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;
  const { id } = await params;

  // 応募の所有者チェック(RLS と二重)
  const { data: appRow } = await supabase
    .from("applications")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!appRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if ((appRow as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = saveAsDocumentSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  // 応募の会社名を取得(タイトル生成用)
  const application = await getApplication(id, user.id);
  if (!application) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const companyName = application.details.company;
  const title = buildDocumentTitle(companyName);

  // 差分(あれば)を取得
  const custom = await getApplicationPrCustomization(id);
  const overrides = custom?.overrides ?? {};

  try {
    if (parsed.data.kind === "resume") {
      const base = await getResume(parsed.data.baseResumeId, user.id);
      if (!base) {
        return NextResponse.json({ error: "base_resume_not_found" }, { status: 404 });
      }
      const merged = applyResumeOverrides(base, overrides);
      const input = buildResumeRequestFromResume(merged, title);
      // 写真は同じパスを引き継ぐ(複製先で再アップロードもされていないため)
      const newId = await createResume(user.id, input, {
        photo_url: base.photoUrl ?? null,
      });
      return NextResponse.json({ ok: true, kind: "resume", id: newId });
    }

    // kind === "cv"
    const baseCv = await getCv(parsed.data.baseCvId, user.id);
    if (!baseCv) {
      return NextResponse.json({ error: "base_cv_not_found" }, { status: 404 });
    }
    const mergedBody = applyCvOverrides(baseCv.body, overrides);
    const newId = await createCv(user.id, {
      title,
      // 履歴書側の documentDate は空(空白なら今日にフォールバック)
      document_date: "",
      license_resume_id: baseCv.licenseResumeId,
      body: mergedBody,
    });
    return NextResponse.json({ ok: true, kind: "cv", id: newId });
  } catch (err) {
    return NextResponse.json(
      {
        error: "save_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}

/**
 * タイトル生成:`{会社名}(YYYY-MM-DD)`、title カラム 100 字に収まるよう会社名を短縮。
 * 日付は JST 基準で「今日」を使う(履歴書一覧での並びを直感的に)。
 */
function buildDocumentTitle(companyName: string): string {
  const today = new Date();
  const jst = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const dateStr = `(${yyyy}-${mm}-${dd})`;
  // 100 字上限 - 日付部(13 字)= 87 字まで会社名に使える
  const maxCompanyLen = 100 - dateStr.length;
  const safeCompany =
    companyName.length > maxCompanyLen ? companyName.slice(0, maxCompanyLen) : companyName;
  return `${safeCompany}${dateStr}`;
}

/**
 * 既存 Resume(camelCase / null 許容)を SaveResumeRequest(snake_case / 空文字許容)に変換。
 *
 * - null → "" に正規化(saveResumeRequestSchema は空文字 OK だが null は許可していない)
 * - title だけは差し替え(複製先の新タイトル)
 */
function buildResumeRequestFromResume(base: Resume, title: string): SaveResumeRequest {
  const n = (v: string | null) => v ?? "";
  return {
    title,
    name: n(base.name),
    name_kana: n(base.nameKana),
    birth_date: n(base.birthDate),
    gender: base.gender,
    postal_code: n(base.postalCode),
    address: n(base.address),
    address_kana: n(base.addressKana),
    phone: n(base.phone),
    email: n(base.email),
    contact_address: n(base.contactAddress),
    contact_address_kana: n(base.contactAddressKana),
    contact_phone: n(base.contactPhone),
    document_date: n(base.documentDate),
    education_history: base.educationHistory,
    licenses: base.licenses,
    motivation_note: n(base.motivationNote),
    personal_requests: n(base.personalRequests),
  };
}
