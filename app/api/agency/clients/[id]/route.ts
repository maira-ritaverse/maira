import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptField } from "@/lib/crypto/field-encryption";
import { getUserRole } from "@/lib/organizations/queries";
import { updateClientRequestSchema } from "@/lib/clients/types";

/**
 * PATCH /api/agency/clients/[id]
 *
 * クライアントレコードを部分更新する。
 * - 認証 + organization_member ガード
 * - RLS により自社のクライアントのみ更新可能。念のため organization_id でも絞る
 *   (RLS が外れた場合の二重防御)。
 * - link_status/linked_user_id/linked_at/revoked_at は別フロー(連携承諾フロー)で
 *   更新するため、ここでは触らない。
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateClientRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // undefined のフィールドは更新対象に含めない(部分更新)
  const updateData: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.name !== undefined) updateData.name = d.name;
  if (d.email !== undefined) updateData.email = d.email;
  if (d.phone !== undefined) updateData.phone = d.phone || null;
  if (d.status !== undefined) updateData.status = d.status;
  if (d.assigned_member_id !== undefined) {
    // 担当を変える場合は、その member.id が自組織のメンバーか検証する
    // (他組織の member.id を担当に書き込めるとデータ整合性が壊れるため)。
    // null は「担当解除」なので検証スキップ。agency_tasks PATCH と同型。
    if (d.assigned_member_id !== null) {
      const { data: memberRow } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("id", d.assigned_member_id)
        .maybeSingle();

      if (!memberRow || memberRow.organization_id !== role.organization.id) {
        return NextResponse.json(
          { error: "Assignee not found in your organization" },
          { status: 404 },
        );
      }
    }
    updateData.assigned_member_id = d.assigned_member_id;
  }
  if (d.notes !== undefined) updateData.notes = d.notes || null;
  // close_reason: undefined = 触らない、null = 「未設定」、文字列 = 値を設定
  // null も明示的に「リセット」として送れるよう、undefined チェックだけにする(falsy 判定にしない)
  if (d.close_reason !== undefined) updateData.close_reason = d.close_reason;
  if (d.email_distribution_enabled !== undefined) {
    updateData.email_distribution_enabled = d.email_distribution_enabled;
  }
  // 平文。空文字は null に倒す(集計時の "" を排除)。
  if (d.entry_site !== undefined) updateData.entry_site = d.entry_site || null;

  // 暗号化フィールドの保存:
  //   - 空文字なら null を保存(暗号化された空文字は無意味)
  //   - 非空なら encryptField で AES-256-GCM 暗号化
  // encryptField は並列実行可。
  if (
    d.recommendation_comment !== undefined ||
    d.other_agency_status !== undefined ||
    d.contact_method_preference !== undefined
  ) {
    const [encRec, encOther, encPref] = await Promise.all([
      d.recommendation_comment === undefined
        ? Promise.resolve(undefined)
        : d.recommendation_comment === ""
          ? Promise.resolve<string | null>(null)
          : encryptField(d.recommendation_comment),
      d.other_agency_status === undefined
        ? Promise.resolve(undefined)
        : d.other_agency_status === ""
          ? Promise.resolve<string | null>(null)
          : encryptField(d.other_agency_status),
      d.contact_method_preference === undefined
        ? Promise.resolve(undefined)
        : d.contact_method_preference === ""
          ? Promise.resolve<string | null>(null)
          : encryptField(d.contact_method_preference),
    ]);
    if (encRec !== undefined) updateData.encrypted_recommendation_comment = encRec;
    if (encOther !== undefined) updateData.encrypted_other_agency_status = encOther;
    if (encPref !== undefined) updateData.encrypted_contact_method_preference = encPref;
  }

  // ────────────────────────────────────────────
  // EMPRO 名簿拡張(マイグレーション 20260615100001)
  // ────────────────────────────────────────────
  // ヘルパ:undefined=部分更新で触らない / "" を null に正規化 / 値はそのまま。
  // 既存パターン(`if (d.x !== undefined) updateData.x = d.x || null;`)を保ちつつ、
  // 30 件近い列を読みやすく並べるためにループで処理する。
  const PLAIN_PASSTHROUGH_KEYS: Array<keyof typeof d> = [
    "name_kana",
    "birth_date",
    "gender",
    "nationality",
    "marital_status",
    "postal_code",
    "prefecture",
    "city",
    "street",
    "building",
    "phone2",
    "email2",
    "current_employment_type",
    "final_education",
    "job_change_timing",
    "intake_date",
    "first_meeting_date",
  ];
  for (const key of PLAIN_PASSTHROUGH_KEYS) {
    const v = d[key];
    if (v === undefined) continue;
    // 空文字 / 空オブジェクト / null は null に倒す。それ以外は値を採用。
    updateData[key] = v === "" || v === null ? null : v;
  }

  // 数値(年収)は preprocessor で空文字 → null に正規化済み。undefined のときだけ触らない。
  if (d.current_annual_income !== undefined)
    updateData.current_annual_income = d.current_annual_income;
  if (d.desired_annual_income !== undefined)
    updateData.desired_annual_income = d.desired_annual_income;

  // タグ配列:undefined=部分更新で触らない / 空配列は「クリア」として null を保存。
  // 一覧の rowToClientRecord は null → [] に正規化するので、UI 側の挙動はそのまま。
  const TAG_ARRAY_KEYS: Array<keyof typeof d> = [
    "experience_industries",
    "experience_occupations",
    "desired_industries",
    "desired_occupations",
    "desired_locations",
  ];
  for (const key of TAG_ARRAY_KEYS) {
    const v = d[key];
    if (v === undefined) continue;
    updateData[key] = Array.isArray(v) && v.length === 0 ? null : v;
  }

  // 暗号化対象(EMPRO 拡張、6 列)。
  // 上の recommendation_comment と同パターン:undefined=触らない / "" → null / 非空 → encryptField。
  const ENCRYPTED_FIELD_MAP = [
    { key: "education_detail", column: "encrypted_education_detail" },
    { key: "skills", column: "encrypted_skills" },
    { key: "job_change_reason", column: "encrypted_job_change_reason" },
    { key: "desired_conditions", column: "encrypted_desired_conditions" },
    { key: "meeting_notes", column: "encrypted_meeting_notes" },
    { key: "status_memo", column: "encrypted_status_memo" },
  ] as const;

  // 触られた暗号化フィールドを集める(undefined なら触らない、"" なら null、値なら encryptField)
  const encJobs = ENCRYPTED_FIELD_MAP.map(({ key, column }) => {
    const v = d[key];
    if (v === undefined) return null;
    if (v === "" || v === null) return { column, value: Promise.resolve<string | null>(null) };
    return { column, value: encryptField(v as string) };
  });

  // 並列暗号化 + updateData への反映
  await Promise.all(
    encJobs.map(async (job) => {
      if (!job) return;
      const encrypted = await job.value;
      updateData[job.column] = encrypted;
    }),
  );

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("client_records")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", role.organization.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
