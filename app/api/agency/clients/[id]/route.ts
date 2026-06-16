import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptField } from "@/lib/crypto/field-encryption";
import { getUserRole } from "@/lib/organizations/queries";
import { updateClientRequestSchema } from "@/lib/clients/types";
import { logClientChanges } from "@/lib/audit/client-audit-log";

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

  // CRM 自由タグ(20260615140001 マイグレーション)。
  // 上記 EMPRO タグ配列と異なり、DB default が '{}' なので「クリア」は [] のまま
  // 保存する(NOT NULL 列なので null は不可)。
  if (d.crm_tags !== undefined) {
    updateData.crm_tags = Array.isArray(d.crm_tags) ? d.crm_tags : [];
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

  // ────────────────────────────────────────────
  // 変更履歴(client_audit_log)用に旧値を取得する。
  // 対象は updateData に含まれる「平文」列のみ。暗号化列は値を残さない方針で除外。
  // ────────────────────────────────────────────
  const PLAIN_LOGGABLE_KEYS = new Set<string>([
    "name",
    "email",
    "phone",
    "status",
    "assigned_member_id",
    "notes",
    "close_reason",
    "entry_site",
    "email_distribution_enabled",
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
    "current_annual_income",
    "final_education",
    "job_change_timing",
    "desired_annual_income",
    "intake_date",
    "first_meeting_date",
    "experience_industries",
    "experience_occupations",
    "desired_industries",
    "desired_occupations",
    "desired_locations",
    "crm_tags",
  ]);
  // 暗号化フィールドの監査:値は記録しないが「変更があった事実」だけは残す。
  // 比較は暗号文同士で行う(平文の復号は行わない、サーバー側に平文を持たないため)。
  // IV はレコード単位で新規生成されるので、同じ平文を再保存しても暗号文は変わる ──
  // つまり「触れたこと」がほぼ「変更があったこと」と同義になるが、それで OK
  // (誤動作で同じ値を上書きしただけでも履歴に「触れた」と残るのは監査的にも望ましい)。
  const ENCRYPTED_LOGGABLE_KEYS = new Set<string>([
    "encrypted_recommendation_comment",
    "encrypted_other_agency_status",
    "encrypted_contact_method_preference",
    "encrypted_education_detail",
    "encrypted_skills",
    "encrypted_job_change_reason",
    "encrypted_desired_conditions",
    "encrypted_meeting_notes",
    "encrypted_status_memo",
  ]);
  const loggableTouchedKeys = Object.keys(updateData).filter(
    (k) => PLAIN_LOGGABLE_KEYS.has(k) || ENCRYPTED_LOGGABLE_KEYS.has(k),
  );
  // SELECT は触られた列のみに絞ってサイズを抑える。
  // 変更履歴目的なので Service Role 不要(RLS で自社のみ読める)。
  let oldRow: Record<string, unknown> | null = null;
  if (loggableTouchedKeys.length > 0) {
    const { data } = await supabase
      .from("client_records")
      .select(loggableTouchedKeys.join(","))
      .eq("id", id)
      .eq("organization_id", role.organization.id)
      .maybeSingle();
    oldRow = (data as Record<string, unknown> | null) ?? null;
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

  // 監査ログ:変更があった列ごとに 1 行ずつ insert。
  // 値の serialize は単純化:文字列はそのまま / 配列は ', ' join / boolean は文字列化 / null は null。
  // 暗号化列は「変更があった」事実だけ残す:old_value = new_value = null とし、
  // field_name の "encrypted_" プレフィックスで UI 側が暗号化変更と識別する。
  if (oldRow && role.member && loggableTouchedKeys.length > 0) {
    const changes = loggableTouchedKeys
      .map((key) => {
        const isEncrypted = ENCRYPTED_LOGGABLE_KEYS.has(key);
        if (isEncrypted) {
          // 暗号文同士で「文字列等価」かを比較する(IV が違うので等価でないことが普通)。
          // null vs null は触れていないと判定してスキップ。
          const oldEnc = (oldRow![key] as string | null) ?? null;
          const newEnc = (updateData[key] as string | null) ?? null;
          if (oldEnc === newEnc) {
            return null;
          }
          return { fieldName: key, oldValue: null, newValue: null };
        }
        const ov = serializeAuditValue(oldRow![key] ?? null);
        const nv = serializeAuditValue(updateData[key] ?? null);
        if (ov === nv) return null;
        return { fieldName: key, oldValue: ov, newValue: nv };
      })
      .filter(
        (c): c is { fieldName: string; oldValue: string | null; newValue: string | null } =>
          c !== null,
      );
    if (changes.length > 0) {
      // 失敗してもユーザ操作は成功扱い(関数内で warn のみ)。
      await logClientChanges(
        {
          organizationId: role.organization.id,
          clientRecordId: id,
          actorMemberId: role.member.id,
        },
        changes,
      );
    }
  }

  return NextResponse.json({ success: true });
}

/**
 * 監査ログの値文字列化:UI 表示と前後比較に使う統一フォーマット。
 *  - 文字列はそのまま(空文字は null に倒す:DB の "" と null を等価扱い)
 *  - 配列は ', ' で連結
 *  - boolean は 'true' / 'false'
 *  - number は文字列化
 *  - その他は JSON 文字列化(jsonb 等の将来拡張に備える)
 */
function serializeAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (Array.isArray(value)) {
    return value.length === 0 ? null : value.map((v) => String(v)).join(", ");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}
