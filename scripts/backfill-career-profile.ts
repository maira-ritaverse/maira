/**
 * career_profiles.encrypted_data_v2 バックフィル + 検証スクリプト(Step 4 一回性ツール)
 *
 * 役割:
 *   1. encrypted_data_v2 が NULL の既存行を、Step 3 と同じ encryptField 経路で
 *      暗号化して埋める(冪等)。
 *   2. 全行(v2 の有無に関わらず)を対象に、encrypted_data_v2 を decryptField で
 *      復号 → JSON.parse → careerProfileSchema で検証 → 旧 encrypted_data
 *      (平文 JSON bytea) と deep equal 比較し、差分を 1 件残らず報告する。
 *   3. 結果を docs/encryption-backfill-career-report.md に書き出す(PII は一切含めない)。
 *
 * 安全(重要):
 *   - 接続先 host に "pfebbpgcufintmulhydg" (= maira-dev) が含まれない場合は即座に
 *     abort する。本番(maira-prod = xxatkimjfiaidxfuglae)への接続を物理的に防ぐ。
 *   - 出力に値を一切含めない(行ID / フィールド名 / 件数 / boolean のみ)。
 *   - 差分があれば exit 1。verify 対象が 0 件なら exit 2(空振りを成功と誤認させない)。
 *
 * 環境変数(env で切り替え。特定環境をハードコードしない):
 *   - NEXT_PUBLIC_SUPABASE_URL または SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY  ← ログ・コミットに残さない
 *   - FIELD_ENCRYPTION_KEYS
 *   - FIELD_ENCRYPTION_CURRENT_VERSION
 *
 * 実行例(dev 用):
 *   pnpm backfill:career-profile
 *   等価:tsx --env-file=.env.local scripts/backfill-career-profile.ts
 *
 * 引数(任意):
 *   --mode=backfill   バックフィルだけを実行
 *   --mode=verify     検証だけを実行(全行)
 *   --mode=both       バックフィル → 検証(デフォルト)
 */

/* eslint-disable no-console */
// CLI スクリプトは stdout で進捗を出す必要があるため console.log を許容する。
// 出力する内容は件数とフィールド名のみで、PII の生値は一切含めない。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { careerProfileSchema } from "@/lib/career/profile-schema";

const BATCH_SIZE = 100;
// dev プロジェクト ref。host に含まれなければ即 abort(本番接続防止)。
const DEV_PROJECT_REF = "pfebbpgcufintmulhydg";

// ============================================
// 引数 / env の読み取り
// ============================================

type Mode = "backfill" | "verify" | "both";

function parseMode(argv: string[]): Mode {
  const arg = argv.find((a) => a.startsWith("--mode="));
  if (!arg) return "both";
  const value = arg.split("=")[1];
  if (value === "backfill" || value === "verify" || value === "both") return value;
  throw new Error(`不正な --mode: ${value}(backfill / verify / both のいずれか)`);
}

function getRequiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value) {
    throw new Error(`環境変数 ${name}${fallback ? ` (or ${fallback})` : ""} が未設定です。`);
  }
  return value;
}

// ============================================
// 行の型(検証 + バックフィル両対応)
// ============================================
type Row = {
  id: string;
  user_id: string;
  encrypted_data: unknown;
  encrypted_data_v2: string | null;
};

type Database = {
  public: {
    Tables: {
      career_profiles: {
        Row: Row;
        Insert: Partial<Row>;
        Update: { encrypted_data_v2?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

type Client = SupabaseClient<Database>;

const SELECT_COLUMNS = ["id", "user_id", "encrypted_data", "encrypted_data_v2"].join(",");

// ============================================
// 共通ユーティリティ
// ============================================

// lib/career/conversations.ts の bytesToText と同じロジック。
// supabase-js が bytea を返す形式が複数あるため両対応する。
function bytesToText(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex").toString("utf-8");
    }
    return Buffer.from(value, "base64").toString("utf-8");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf-8");
  }
  return "";
}

// 順序非依存の deep equal(オブジェクトのキー順差で誤って差分判定しないため)。
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a as Record<string, unknown>).sort();
  const bk = Object.keys(b as Record<string, unknown>).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[ak[i]], (b as Record<string, unknown>)[bk[i]]))
      return false;
  }
  return true;
}

// 差分のあるフィールドパスを返す(値は含めない)。
function diffFields(a: unknown, b: unknown, prefix = ""): string[] {
  if (deepEqual(a, b)) return [];
  const isObjA = typeof a === "object" && a !== null;
  const isObjB = typeof b === "object" && b !== null;
  if (!isObjA || !isObjB || Array.isArray(a) !== Array.isArray(b)) {
    return [prefix || "<root>"];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${prefix || "<root>"}[length]`];
    const out: string[] = [];
    for (let i = 0; i < a.length; i++) {
      out.push(...diffFields(a[i], b[i], `${prefix}[${i}]`));
    }
    return out;
  }
  const keys = new Set([
    ...Object.keys(a as Record<string, unknown>),
    ...Object.keys(b as Record<string, unknown>),
  ]);
  const out: string[] = [];
  for (const k of keys) {
    out.push(
      ...diffFields(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        prefix ? `${prefix}.${k}` : k,
      ),
    );
  }
  return out;
}

// ============================================
// バックフィルフェーズ
// ============================================

type BackfillResult = {
  scanned: number;
  encrypted: number;
};

async function runBackfill(supabase: Client): Promise<BackfillResult> {
  let scanned = 0;
  let encrypted = 0;

  // encrypted_data_v2 IS NULL の行だけを ID 昇順・100件バッチで処理。
  // 書き込んだら次のバッチでは自動的に対象外になる(冪等)。
  while (true) {
    const { data, error } = await supabase
      .from("career_profiles")
      .select(SELECT_COLUMNS)
      .is("encrypted_data_v2", null)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`バックフィル SELECT 失敗: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    scanned += data.length;

    for (const row of data as unknown as Row[]) {
      const jsonString = bytesToText(row.encrypted_data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonString);
      } catch (e) {
        throw new Error(
          `行 ${row.id} の旧 bytea が valid JSON ではありません: ${(e as Error).message}`,
        );
      }
      // 旧 JSON もスキーマ検証してから再暗号化(壊れたデータをそのまま v2 に焼き直さない)
      const validated = careerProfileSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error(`行 ${row.id} の旧 JSON が careerProfileSchema 不一致`);
      }

      // 既存 JSON 文字列をそのまま再暗号化(整形なし、deep equal 比較の前提)
      const ciphertext = await encryptField(JSON.stringify(parsed));
      if (typeof ciphertext !== "string" || ciphertext.length === 0) {
        throw new Error(`行 ${row.id} の暗号化に失敗(空文字を返した)。アボートします。`);
      }

      const { error: updateError } = await supabase
        .from("career_profiles")
        .update({ encrypted_data_v2: ciphertext })
        .eq("id", row.id)
        // 二重防御:他プロセスが書き込んでいないことを念のため確認
        .is("encrypted_data_v2", null);

      if (updateError) {
        throw new Error(`行 ${row.id} の UPDATE 失敗: ${updateError.message}`);
      }
      encrypted += 1;
    }

    console.log(`  backfill batch: scanned=${scanned}, encrypted=${encrypted}`);

    if (data.length < BATCH_SIZE) break;
  }

  return { scanned, encrypted };
}

// ============================================
// 検証フェーズ(全行対象)
// ============================================

type RowDiff = { rowId: string; fields: string[] };

type VerifyResult = {
  total: number;
  matched: number;
  mismatched: RowDiff[];
};

async function runVerify(supabase: Client): Promise<VerifyResult> {
  let total = 0;
  let matched = 0;
  const mismatched: RowDiff[] = [];

  let cursor: string | null = null;
  while (true) {
    let query = supabase
      .from("career_profiles")
      .select(SELECT_COLUMNS)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (cursor) {
      query = query.gt("id", cursor);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`検証 SELECT 失敗: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const row of data as unknown as Row[]) {
      total += 1;
      cursor = row.id;

      // v2 が NULL なら未バックフィル(本来は backfill フェーズで埋まっているはず)
      if (!row.encrypted_data_v2) {
        mismatched.push({ rowId: row.id, fields: ["<v2 is NULL>"] });
        continue;
      }

      // v2 を復号 → JSON.parse → schema 検証
      let v2Plaintext: string | null | undefined;
      try {
        v2Plaintext = await decryptField(row.encrypted_data_v2);
      } catch (e) {
        // 鍵不一致 / GCM 認証タグ NG / 改竄など。詳細は出さず種別だけ。
        mismatched.push({
          rowId: row.id,
          fields: [`<decrypt failed: ${(e as Error).name}>`],
        });
        continue;
      }
      if (typeof v2Plaintext !== "string" || v2Plaintext.length === 0) {
        mismatched.push({ rowId: row.id, fields: ["<decrypt returned non-string/empty>"] });
        continue;
      }

      let v2Obj: unknown;
      try {
        v2Obj = JSON.parse(v2Plaintext);
      } catch {
        mismatched.push({ rowId: row.id, fields: ["<v2 JSON.parse failed>"] });
        continue;
      }
      const v2Validated = careerProfileSchema.safeParse(v2Obj);
      if (!v2Validated.success) {
        mismatched.push({ rowId: row.id, fields: ["<v2 schema mismatch>"] });
        continue;
      }

      // 旧 bytea を JSON.parse → schema 検証
      const legacyJsonString = bytesToText(row.encrypted_data);
      let legacyObj: unknown;
      try {
        legacyObj = JSON.parse(legacyJsonString);
      } catch {
        mismatched.push({ rowId: row.id, fields: ["<legacy bytea JSON.parse failed>"] });
        continue;
      }
      const legacyValidated = careerProfileSchema.safeParse(legacyObj);
      if (!legacyValidated.success) {
        mismatched.push({ rowId: row.id, fields: ["<legacy schema mismatch>"] });
        continue;
      }

      // deep equal 比較
      const fields = diffFields(legacyValidated.data, v2Validated.data);
      if (fields.length === 0) {
        matched += 1;
      } else {
        mismatched.push({ rowId: row.id, fields });
      }
    }

    console.log(
      `  verify batch: total=${total}, matched=${matched}, mismatched=${mismatched.length}`,
    );
    if (data.length < BATCH_SIZE) break;
  }

  return { total, matched, mismatched };
}

// ============================================
// レポート出力(PII は含めない)
// ============================================

const REPORT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "encryption-backfill-career-report.md",
);

async function writeReport(opts: {
  mode: Mode;
  startedAt: string;
  finishedAt: string;
  host: string;
  backfill: BackfillResult | null;
  verify: VerifyResult | null;
  emptyVerify: boolean;
}): Promise<void> {
  const { mode, startedAt, finishedAt, host, backfill, verify, emptyVerify } = opts;

  let body = `# career_profile バックフィル / 検証レポート(Step 4)\n\n`;
  body += `- 実行モード: \`${mode}\`\n`;
  body += `- 開始: ${startedAt}\n`;
  body += `- 終了: ${finishedAt}\n`;
  body += `- 対象: \`public.career_profiles\`\n`;
  body += `- 接続先 host: \`${host}\` (maira-dev のみ許可)\n`;
  body += `- PII の生値は一切含めない(件数 / フィールド名 / 差分種別のみ)\n\n`;

  if (backfill) {
    body += `## バックフィル結果\n\n`;
    body += `- スキャン対象(encrypted_data_v2 IS NULL の行): ${backfill.scanned} 件\n`;
    body += `- 暗号化して書き込んだ行: ${backfill.encrypted} 件\n\n`;
  }

  if (verify) {
    const passed = !emptyVerify && verify.mismatched.length === 0;
    body += `## 検証結果(全行対象)\n\n`;
    body += `- ステータス: ${
      emptyVerify
        ? "**WARN(検証対象 0 件・空振り)**"
        : passed
          ? "**PASS(差分 0)**"
          : "**FAIL(差分あり)**"
    }\n`;
    body += `- 対象行(career_profiles 全行): ${verify.total} 件\n`;
    body += `- 一致: ${verify.matched} 件\n`;
    body += `- 不一致: ${verify.mismatched.length} 件\n\n`;

    if (verify.mismatched.length > 0) {
      body += `### 差分のある行 ID 一覧\n\n`;
      for (const r of verify.mismatched) {
        const fields = [...r.fields].sort().join(", ");
        body += `- \`${r.rowId}\` — フィールド/種別: ${fields}\n`;
      }
      body += `\n`;
    }
  }

  body += `## 次のステップ\n\n`;
  if (emptyVerify) {
    body += `検証対象が 0 件のため Step 5/6 には進まない(空振りを成功扱いにしない)。\n`;
  } else if (verify && verify.mismatched.length === 0) {
    body += `差分 0 が確認できたので、Step 5(読み出しを v2 優先に切替)に進める。\n`;
  } else if (verify) {
    body += `差分が残っているため Step 5 には進まない。原因を調査して再実行する。\n`;
    body += `ロールバック手段:該当行の encrypted_data_v2 を NULL に戻せば readers は引き続き旧 bytea を読む(Step 5 以前なので影響なし)。\n`;
  }

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, body, "utf-8");
  console.log(`  report written: ${REPORT_PATH}`);
}

// ============================================
// main
// ============================================

async function main() {
  const mode = parseMode(process.argv.slice(2));

  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  // 鍵そのものは encryptField/decryptField 内部で参照されるだけだが、未設定なら早期に落とす
  getRequiredEnv("FIELD_ENCRYPTION_KEYS");
  getRequiredEnv("FIELD_ENCRYPTION_CURRENT_VERSION");

  const host = (() => {
    try {
      return new URL(supabaseUrl).host;
    } catch {
      return "(unknown)";
    }
  })();

  // 本番接続を物理的に防ぐガード(maira-prod の ref が含まれていれば疑わずに abort)
  if (!host.includes(DEV_PROJECT_REF)) {
    console.error(
      `[ABORT] 本スクリプトは maira-dev (${DEV_PROJECT_REF}) でのみ動作可能です。` +
        ` 接続先 host が "${host}" のため中断します。.env.local を確認してください。`,
    );
    process.exit(10);
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[backfill-career-profile] mode=${mode}, supabase=${host} (maira-dev)`);

  const startedAt = new Date().toISOString();

  let backfillResult: BackfillResult | null = null;
  let verifyResult: VerifyResult | null = null;

  if (mode === "backfill" || mode === "both") {
    console.log(`[backfill phase]`);
    backfillResult = await runBackfill(supabase);
    console.log(`  done: scanned=${backfillResult.scanned}, encrypted=${backfillResult.encrypted}`);
  }

  if (mode === "verify" || mode === "both") {
    console.log(`[verify phase]`);
    verifyResult = await runVerify(supabase);
    console.log(
      `  done: total=${verifyResult.total}, matched=${verifyResult.matched}, mismatched=${verifyResult.mismatched.length}`,
    );
  }

  const finishedAt = new Date().toISOString();
  const emptyVerify = verifyResult !== null && verifyResult.total === 0;

  await writeReport({
    mode,
    startedAt,
    finishedAt,
    host,
    backfill: backfillResult,
    verify: verifyResult,
    emptyVerify,
  });

  // 検証対象 0 件は空振り。成功と区別するため exit 2。
  if (emptyVerify) {
    console.error(
      `[FAIL] verify 対象が 0 件です(空振り)。dev に career_profiles の行が存在しない可能性。Step 5 には進めない。`,
    );
    process.exit(2);
  }

  // 差分があれば非ゼロ終了
  if (verifyResult && verifyResult.mismatched.length > 0) {
    console.error(
      `[FAIL] ${verifyResult.mismatched.length} 行に差分があります。Step 5 には進めない。`,
    );
    process.exit(1);
  }

  console.log(`[OK]`);
}

main().catch((err) => {
  console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
