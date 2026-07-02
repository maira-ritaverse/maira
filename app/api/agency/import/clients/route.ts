import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createClientRequestSchema } from "@/lib/clients/types";

/**
 * POST /api/agency/import/clients
 *
 * 顧客名簿の CSV インポートを受け付ける。
 * フロントで CSV → Record<string, string>[] にパース済みのデータを送る。
 *
 * 仕様:
 *   - 認証 + organization_member ガード
 *   - 列マッピングは日本語ヘッダー固定(エクスポート CSV との往復が前提)。
 *     氏名 / メール は必須。それ以外は任意。
 *   - 同 organization に同 email のレコードが既にあれば「重複」として skip
 *     (既存の連携状態や名簿入力を上書きしないため)。
 *   - 1 リクエスト最大 500 行(無制限投入で誤コピペ→大量増殖を防ぐ)。
 *   - エラー行があっても他の正常行は登録する(部分成功)。
 *   - assigned_member_id は呼び出しユーザ(=デフォルト担当)に固定。
 *
 * セキュリティ:
 *   - 平文の name / email / phone / name_kana / prefecture / 備考 / intake_date /
 *     entry_site のみ受け付ける(暗号化フィールドは UI 側で 1 件ずつ入力する運用)。
 *   - 行数上限とサイズ上限(8 MiB)で DoS を抑える。
 */

const MAX_ROWS = 500;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * CSV ヘッダー(日本語)→ DB / zod のキー(snake_case)へのマッピング。
 * エクスポート CSV のヘッダーと合わせている。複数表記を許容するため Array で持つ。
 *
 * 「求職者管理 で 編集 できる 項目 は CSV でも 入力 できる」 方針。 EMPRO 拡張 の
 * 平文 カラム を 網羅 する ( 暗号化 対象 は 除外 = UI 側 で 1 件 ずつ 入力 )。
 */
const HEADER_ALIASES: Record<string, string[]> = {
  // 基本 属性
  name: ["氏名", "名前", "name"],
  name_kana: ["氏名カナ", "カナ", "name_kana"],
  email: ["メール", "メールアドレス", "email"],
  phone: ["電話", "電話番号", "phone"],
  phone2: ["副電話", "電話2", "phone2"],
  email2: ["副メール", "メール2", "email2"],
  birth_date: ["生年月日", "誕生日", "birth_date"],
  gender: ["性別", "gender"],
  nationality: ["国籍", "nationality"],
  marital_status: ["配偶", "婚姻", "配偶者", "marital_status"],
  // 住所
  postal_code: ["郵便番号", "postal_code"],
  prefecture: ["都道府県", "prefecture"],
  city: ["市区町村", "city"],
  street: ["番地", "町名", "street"],
  building: ["建物", "マンション", "building"],
  // 現職 情報
  current_employment_type: ["現職雇用形態", "雇用形態", "current_employment_type"],
  current_annual_income: ["現年収", "現在年収", "current_annual_income"],
  final_education: ["最終学歴", "学歴", "final_education"],
  // 希望 条件
  desired_industries: ["希望業種", "desired_industries"],
  desired_occupations: ["希望職種", "desired_occupations"],
  desired_locations: ["希望勤務地", "希望地", "desired_locations"],
  desired_annual_income: ["希望年収", "desired_annual_income"],
  job_change_timing: ["転職時期", "job_change_timing"],
  // 経験
  experience_industries: ["経験業種", "experience_industries"],
  experience_occupations: ["経験職種", "experience_occupations"],
  // 運用 キー 日付
  intake_date: ["受付日", "受付日時", "intake_date"],
  first_meeting_date: ["初回面談日", "初回面談", "first_meeting_date"],
  // その他
  entry_site: ["媒体", "エントリーサイト", "entry_site"],
  notes: ["備考", "メモ", "notes"],
  crm_tags: ["タグ", "CRMタグ", "crm_tags"],
  // 担当 アドバイザー ( 別担当 に アサインしたい 時のみ )
  assignee_email: [
    "担当者メールアドレス",
    "担当メール",
    "担当アドバイザー",
    "担当アドバイザーメール",
    "assignee_email",
  ],
};

/** CSV セル → 数値。 「万円」 「,」 等 を 除去 して 数値 化。 空 or 変換 不能 は undefined。 */
function parseNumericField(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[,、円万￥¥\s]/g, "");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** CSV セル → 配列。 「/」 「,」 「;」 「、」 で split。 空要素 は 除去。 */
function parseArrayField(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(/[/,;、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/** CSV 行 1 件のキー(任意ヘッダー)を canonical key へ正規化する。 */
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

/** YYYY/MM/DD → YYYY-MM-DD(日付フィールド入力の救済) */
function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const slashMatch = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const y = slashMatch[1];
    const m = slashMatch[2].padStart(2, "0");
    const d = slashMatch[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return value;
}

type ImportResultRow = {
  /** 入力 CSV における行番号(ヘッダー除外、1 始まり) */
  rowIndex: number;
  /** "created" / "skipped_duplicate" / "error" */
  outcome: "created" | "skipped_duplicate" | "error";
  /** error / skipped 時のメッセージ */
  message?: string;
  /** 作成成功時の client_records.id */
  clientId?: string;
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

  // ボディサイズの先制チェック(誤コピペで巨大 CSV が来る事故防止)
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

  // 既存メールを取得して重複判定。RLS で自組織のみに絞られるが、明示的にも絞る。
  // 1000 件超え組織では full scan になり得るが、import の頻度は低い前提で許容する。
  const { data: existingRows } = await supabase
    .from("client_records")
    .select("email")
    .eq("organization_id", role.organization.id);
  const existingEmails = new Set<string>();
  if (existingRows) {
    for (const r of existingRows as Array<{ email: string }>) {
      existingEmails.add(r.email.toLowerCase());
    }
  }

  // 担当 アドバイザー の 割り当て 用 lookup。 CSV に 「assignee_email」 列 が あれば、
  // その メール で 同 組織 の organization_members を 探して assigned_member_id に する。
  // 一致 し ない 行 は 呼び出し ユーザー を 担当 に fallback ( 従来 挙動 )。
  //
  // auth.users.email は RLS で 保護 されて いる ため、 SECURITY DEFINER RPC
  // list_organization_members_with_meta を 経由 する。 同 org メンバー のみ 見える 実装。
  const memberEmailToId = new Map<string, string>();
  {
    const { data: memberRows } = await supabase.rpc("list_organization_members_with_meta", {
      target_organization_id: role.organization.id,
    });
    for (const row of (memberRows ?? []) as Array<{
      member_id: string;
      email: string | null;
    }>) {
      if (row.email) memberEmailToId.set(row.email.toLowerCase(), row.member_id);
    }
  }

  const results: ImportResultRow[] = [];
  // 1 行ずつ validate → insert。バルク insert は失敗時の部分成功制御が難しいので
  // 1 件単位で回す(MAX_ROWS=500 件なので往復コストは許容範囲)。
  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const raw = rows[i];
    if (typeof raw !== "object" || raw === null) {
      results.push({ rowIndex, outcome: "error", message: "行がオブジェクト形式ではありません" });
      continue;
    }
    const normalized = normalizeRow(raw as Record<string, string>);
    // 日付の救済(YYYY/MM/DD → YYYY-MM-DD)
    if (normalized.intake_date) {
      normalized.intake_date = normalizeDate(normalized.intake_date) ?? normalized.intake_date;
    }
    if (normalized.birth_date) {
      normalized.birth_date = normalizeDate(normalized.birth_date) ?? normalized.birth_date;
    }
    if (normalized.first_meeting_date) {
      normalized.first_meeting_date =
        normalizeDate(normalized.first_meeting_date) ?? normalized.first_meeting_date;
    }

    // メールの重複チェック(in-batch 重複も既存と同じく "重複" として扱う)
    const emailLower = (normalized.email ?? "").toLowerCase();
    if (emailLower && existingEmails.has(emailLower)) {
      results.push({
        rowIndex,
        outcome: "skipped_duplicate",
        message: `メールが既に登録されています: ${normalized.email}`,
      });
      continue;
    }

    // createClientRequestSchema は entry_site, notes 等を受け付ける。
    // prefecture / 暗号化フィールドはここでは受けないので、別途 PATCH で埋める運用。
    const parsed = createClientRequestSchema.safeParse(normalized);
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

    // 担当 アドバイザー の 割り当て:
    //   ・CSV に 「担当 者 メール」 が あって、 同 組織 の メンバー なら その 人 を 担当
    //   ・上記 以外 は 呼び出し ユーザー を 担当 に fallback ( 従来 挙動 )
    const assigneeEmailLower = (normalized.assignee_email ?? "").toLowerCase().trim();
    const resolvedAssigneeMemberId =
      (assigneeEmailLower && memberEmailToId.get(assigneeEmailLower)) || role.member.id;

    const insertRow: Record<string, unknown> = {
      organization_id: role.organization.id,
      assigned_member_id: resolvedAssigneeMemberId,
      name: d.name,
      email: d.email,
      phone: d.phone || null,
      status: d.status,
      notes: d.notes || null,
      link_status: "unlinked",
      entry_site: d.entry_site || null,
      email_distribution_enabled: d.email_distribution_enabled,
      name_kana: d.name_kana || null,
      intake_date: d.intake_date || null,
    };

    // EMPRO 拡張 の 平文 列 を まとめて 追加。 createClientRequestSchema には ない
    // 列 も DB には ある ので、 normalized から 直接 渡す ( 未 検証 だが 全部 text/enum/date
    // で、 型 不一致 は DB 側 CHECK で 弾かれる )。
    const passthroughText: Array<keyof typeof HEADER_ALIASES> = [
      "phone2",
      "email2",
      "gender",
      "nationality",
      "marital_status",
      "postal_code",
      "prefecture",
      "city",
      "street",
      "building",
      "current_employment_type",
      "final_education",
      "job_change_timing",
    ];
    for (const key of passthroughText) {
      if (normalized[key]) insertRow[key] = normalized[key];
    }
    if (normalized.birth_date) insertRow.birth_date = normalized.birth_date;
    if (normalized.first_meeting_date) insertRow.first_meeting_date = normalized.first_meeting_date;

    // 数値 系 ( 年収 は 万 円 単位 で 保存 )
    const currentIncome = parseNumericField(normalized.current_annual_income);
    if (currentIncome !== undefined) insertRow.current_annual_income = currentIncome;
    const desiredIncome = parseNumericField(normalized.desired_annual_income);
    if (desiredIncome !== undefined) insertRow.desired_annual_income = desiredIncome;

    // 配列 系 ( タグ / 業種 / 職種 / 勤務 地 )
    const passthroughArray: Array<keyof typeof HEADER_ALIASES> = [
      "desired_industries",
      "desired_occupations",
      "desired_locations",
      "experience_industries",
      "experience_occupations",
      "crm_tags",
    ];
    for (const key of passthroughArray) {
      const parsedArr = parseArrayField(normalized[key]);
      if (parsedArr) insertRow[key] = parsedArr;
    }

    const { data: insertedRow, error } = await supabase
      .from("client_records")
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

    existingEmails.add(emailLower); // 同一 CSV 内の重複も以後はスキップ
    results.push({ rowIndex, outcome: "created", clientId: insertedRow.id as string });
  }

  const created = results.filter((r) => r.outcome === "created").length;
  const skippedDuplicate = results.filter((r) => r.outcome === "skipped_duplicate").length;
  const errors = results.filter((r) => r.outcome === "error").length;

  return NextResponse.json({ created, skippedDuplicate, errors, results });
}
