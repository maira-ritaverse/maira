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
 */
const HEADER_ALIASES: Record<string, string[]> = {
  name: ["氏名", "名前", "name"],
  email: ["メール", "メールアドレス", "email"],
  phone: ["電話", "電話番号", "phone"],
  name_kana: ["氏名カナ", "カナ", "name_kana"],
  intake_date: ["受付日", "受付日時", "intake_date"],
  prefecture: ["都道府県", "prefecture"],
  entry_site: ["媒体", "エントリーサイト", "entry_site"],
  notes: ["備考", "メモ", "notes"],
};

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
    const insertRow: Record<string, unknown> = {
      organization_id: role.organization.id,
      assigned_member_id: role.member.id,
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
    // prefecture はスキーマ外なので直接渡す(zod で受け付けないが DB の列は存在)。
    if (normalized.prefecture) {
      insertRow.prefecture = normalized.prefecture;
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
