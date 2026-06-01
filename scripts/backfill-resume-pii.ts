/**
 * resumes.encrypted_pii バックフィル + 検証スクリプト(Step 3b 一回性ツール)
 *
 * 役割:
 *   1. encrypted_pii が NULL の既存行を、3a と同じ pickResumePii / serializeResumePii /
 *      encryptField の経路で暗号化して埋める(冪等)。
 *   2. encrypted_pii が非 NULL の全行について、復号した blob と個別 PII カラムを
 *      compareRowToBlob で照合し、差分があれば 1 件残らず報告する。
 *   3. 結果を docs/encryption-backfill-report.md に書き出す(PII は一切含まない)。
 *
 * 環境変数(env で切り替え可能。特定環境をハードコードしない):
 *   - NEXT_PUBLIC_SUPABASE_URL または SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY  ← ログ・コミットに残さない
 *   - FIELD_ENCRYPTION_KEYS
 *   - FIELD_ENCRYPTION_CURRENT_VERSION
 *
 * 実行例(dev 用):
 *   pnpm backfill:resume-pii
 *   等価:tsx --env-file=.env.local scripts/backfill-resume-pii.ts
 *
 * 引数(任意):
 *   --mode=backfill   バックフィルだけを実行
 *   --mode=verify     検証だけを実行(既に書き込まれた blob を確認)
 *   --mode=both       バックフィル → 検証(デフォルト)
 *
 * 安全:
 *   - 個別 PII カラムは読み取り専用で扱う(更新するのは encrypted_pii のみ)。
 *   - 差分があれば exit code 1。CI で停止できる。
 *   - PII の生値はログにも report.md にも一切書かない。
 */

/* eslint-disable no-console */
// CLI スクリプトは stdout で進捗を出す必要があるため console.log を許容する。
// 出力する内容は件数とフィールド名のみで、PII の生値は一切含めない。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pickResumePii, serializeResumePii, deserializeResumePii } from "@/lib/resumes/pii-fields";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import {
  compareRowToBlob,
  summarizeDiffs,
  type ResumeRowForVerify,
  type RowDiff,
} from "@/lib/resumes/verify-pii";

const BATCH_SIZE = 100;

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
// 行の型(検証用 + 個別カラム + encrypted_pii)
// ============================================
type ResumeRow = ResumeRowForVerify & {
  encrypted_pii: string | null;
  user_id: string;
};

/**
 * supabase-js の型推論ガイド用の最小 Database 型。
 *
 * Database 型を渡さずに createClient<>() を呼ぶと、最近の supabase-js は
 * スキーマ未知のクライアントを返し update() の型が never に潰れる。
 * このスクリプトが触るのは resumes の encrypted_pii だけなので、
 * その 1 カラムに絞った最小型で十分。
 */
type Database = {
  public: {
    Tables: {
      resumes: {
        Row: ResumeRow;
        Insert: Partial<ResumeRow>;
        Update: { encrypted_pii?: string };
        // supabase-js の GenericTable 制約を満たすために必要
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

type Client = SupabaseClient<Database>;

const SELECT_COLUMNS = [
  "id",
  "user_id",
  "name",
  "name_kana",
  "birth_date",
  "gender",
  "postal_code",
  "address",
  "address_kana",
  "phone",
  "email",
  "contact_address",
  "contact_address_kana",
  "contact_phone",
  "photo_url",
  "education_history",
  "licenses",
  "motivation_note",
  "personal_requests",
  "encrypted_pii",
].join(",");

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

  // encrypted_pii IS NULL の行だけを取る。バッチごとに ID 昇順で取り、
  // 書き込んだら次のバッチで自動的に対象外になる(冪等)。
  // Supabase の .is("encrypted_pii", null) は IS NULL に変換される。
  while (true) {
    const { data, error } = await supabase
      .from("resumes")
      .select(SELECT_COLUMNS)
      .is("encrypted_pii", null)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`バックフィル SELECT 失敗: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    scanned += data.length;

    for (const row of data as unknown as ResumeRow[]) {
      const pii = pickResumePii({
        name: row.name,
        name_kana: row.name_kana,
        birth_date: row.birth_date,
        gender: row.gender,
        postal_code: row.postal_code,
        address: row.address,
        address_kana: row.address_kana,
        phone: row.phone,
        email: row.email,
        contact_address: row.contact_address,
        contact_address_kana: row.contact_address_kana,
        contact_phone: row.contact_phone,
        photo_url: row.photo_url,
        education_history: row.education_history,
        licenses: row.licenses,
        motivation_note: row.motivation_note,
        personal_requests: row.personal_requests,
      });
      const json = serializeResumePii(pii);
      const ciphertext = await encryptField(json);
      if (typeof ciphertext !== "string" || ciphertext.length === 0) {
        throw new Error(`行 ${row.id} の暗号化に失敗(空文字を返した)。アボートします。`);
      }

      const { error: updateError } = await supabase
        .from("resumes")
        .update({ encrypted_pii: ciphertext })
        .eq("id", row.id)
        // 二重防御:他プロセスが書き込んでいないことを念のため確認
        .is("encrypted_pii", null);

      if (updateError) {
        throw new Error(`行 ${row.id} の UPDATE 失敗: ${updateError.message}`);
      }
      encrypted += 1;
    }

    // PII は出力しない。件数進捗のみ。
    console.log(`  backfill batch: scanned=${scanned}, encrypted=${encrypted}`);

    // バッチサイズ未満で来たら次は空のはず。早期終了。
    if (data.length < BATCH_SIZE) break;
  }

  return { scanned, encrypted };
}

// ============================================
// 検証フェーズ
// ============================================

type VerifyResult = {
  total: number;
  matched: number;
  mismatched: RowDiff[];
};

async function runVerify(supabase: Client): Promise<VerifyResult> {
  let total = 0;
  let matched = 0;
  const mismatched: RowDiff[] = [];

  // 全行(encrypted_pii が非 NULL)を ID 昇順でストリーミング
  let cursor: string | null = null;
  while (true) {
    let query = supabase
      .from("resumes")
      .select(SELECT_COLUMNS)
      .not("encrypted_pii", "is", null)
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

    for (const row of data as unknown as ResumeRow[]) {
      total += 1;
      cursor = row.id;

      if (!row.encrypted_pii) {
        // ガード(クエリで除外済みのはずだが念のため)
        continue;
      }

      let plaintext: string | null | undefined;
      try {
        plaintext = await decryptField(row.encrypted_pii);
      } catch (err) {
        // 復号失敗 = 鍵不一致 / 改竄。差分扱いで止める。
        mismatched.push({
          rowId: row.id,
          diffs: [{ field: "name", kind: "value_mismatch" }],
        });
        console.error(`  decrypt FAILED for row=${row.id}: ${(err as Error).message}`);
        continue;
      }
      if (typeof plaintext !== "string") {
        mismatched.push({
          rowId: row.id,
          diffs: [{ field: "name", kind: "value_mismatch" }],
        });
        continue;
      }

      const blob = deserializeResumePii(plaintext);
      const rowForVerify: ResumeRowForVerify = {
        id: row.id,
        name: row.name,
        name_kana: row.name_kana,
        birth_date: row.birth_date,
        gender: row.gender,
        postal_code: row.postal_code,
        address: row.address,
        address_kana: row.address_kana,
        phone: row.phone,
        email: row.email,
        contact_address: row.contact_address,
        contact_address_kana: row.contact_address_kana,
        contact_phone: row.contact_phone,
        photo_url: row.photo_url,
        education_history: row.education_history,
        licenses: row.licenses,
        motivation_note: row.motivation_note,
        personal_requests: row.personal_requests,
      };

      const diffs = compareRowToBlob(rowForVerify, blob);
      if (diffs.length === 0) {
        matched += 1;
      } else {
        mismatched.push({ rowId: row.id, diffs });
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
  "encryption-backfill-report.md",
);

async function writeReport(opts: {
  mode: Mode;
  startedAt: string;
  finishedAt: string;
  backfill: BackfillResult | null;
  verify: VerifyResult | null;
}): Promise<void> {
  const { mode, startedAt, finishedAt, backfill, verify } = opts;

  let body = `# 履歴書 PII バックフィル / 検証レポート(Step 3b)\n\n`;
  body += `- 実行モード: \`${mode}\`\n`;
  body += `- 開始: ${startedAt}\n`;
  body += `- 終了: ${finishedAt}\n`;
  body += `- 対象: \`public.resumes\`\n`;
  body += `- 実行環境: 環境変数で切替(本レポート生成時は dev 環境を想定)\n`;
  body += `- PII の生値は一切含めない(件数 / フィールド名 / 差分種別のみ)\n\n`;

  if (backfill) {
    body += `## バックフィル結果\n\n`;
    body += `- スキャン対象(encrypted_pii IS NULL の行): ${backfill.scanned} 件\n`;
    body += `- 暗号化して書き込んだ行: ${backfill.encrypted} 件\n\n`;
  }

  if (verify) {
    const passed = verify.mismatched.length === 0;
    body += `## 検証結果\n\n`;
    body += `- ステータス: ${passed ? "**PASS(差分 0)**" : "**FAIL(差分あり)**"}\n`;
    body += `- 対象行(encrypted_pii IS NOT NULL): ${verify.total} 件\n`;
    body += `- 一致: ${verify.matched} 件\n`;
    body += `- 不一致: ${verify.mismatched.length} 件\n\n`;

    if (!passed) {
      body += `### 差分内訳(field:kind の集計)\n\n`;
      const summary = summarizeDiffs(verify.mismatched);
      const keys = Object.keys(summary).sort();
      for (const key of keys) {
        body += `- \`${key}\`: ${summary[key]} 件\n`;
      }
      body += `\n### 差分のある行 ID 一覧\n\n`;
      for (const r of verify.mismatched) {
        const fields = r.diffs
          .map((d) => d.field)
          .sort()
          .join(", ");
        body += `- \`${r.rowId}\` — フィールド: ${fields}\n`;
      }
      body += `\n`;
    }
  }

  body += `## 次のステップ\n\n`;
  if (verify && verify.mismatched.length === 0) {
    body += `差分 0 が確認できたので、Step 3c(旧 PII カラム削除)に進める。\n`;
  } else if (verify) {
    body += `差分が残っているため Step 3c には進まない。原因を調査して再実行する。\n`;
    body += `ロールバック手段:該当行の encrypted_pii を NULL に戻せば read は個別カラムにフォールバックする。\n`;
  } else {
    body += `verify モードを実行して差分 0 を確認してから Step 3c に進む。\n`;
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
  // 鍵そのものは encryptField 内部で参照されるだけだが、未設定なら早期に落とす
  getRequiredEnv("FIELD_ENCRYPTION_KEYS");
  getRequiredEnv("FIELD_ENCRYPTION_CURRENT_VERSION");

  // service role でつなぐ。autoRefresh / persistSession は CLI 用途では不要。
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 念のため:接続先 URL を表示(host だけ)
  const host = (() => {
    try {
      return new URL(supabaseUrl).host;
    } catch {
      return "(unknown)";
    }
  })();
  console.log(`[backfill-resume-pii] mode=${mode}, supabase=${host}`);

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
  await writeReport({
    mode,
    startedAt,
    finishedAt,
    backfill: backfillResult,
    verify: verifyResult,
  });

  // 差分があれば非ゼロ終了(CI で停止できるように)
  if (verifyResult && verifyResult.mismatched.length > 0) {
    console.error(
      `[FAIL] ${verifyResult.mismatched.length} 行に差分があります。Step 3c には進めません。`,
    );
    process.exit(1);
  }

  console.log(`[OK]`);
}

main().catch((err) => {
  console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
