/**
 * 機密フィールドの AES-256-GCM バックフィル スクリプト
 *
 * 対象テーブル / カラム:
 *   ・applications.encrypted_details_v2
 *   ・tasks.encrypted_title_v2
 *   ・tasks.encrypted_description_v2
 *   ・messages.encrypted_content_v2
 *
 * 動作:
 *   ・各カラムを 500 行ずつ SELECT(id, ciphertext)
 *   ・"v{n}:" プレフィックス無しは「未暗号化平文」と判定
 *   ・encryptField で暗号化し、同じ列に UPDATE で書き戻し
 *   ・既に "v{n}:" 付き(= 暗号化済 or マイグレーション後の新規行)はスキップ
 *
 * 使い方:
 *   ・.env.local に FIELD_ENCRYPTION_KEYS / FIELD_ENCRYPTION_CURRENT_VERSION /
 *     NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要
 *   ・dev:  pnpm tsx scripts/backfill-field-encryption.ts
 *   ・prod: 別途 .env.local.prod 等で prod 値を流し込んで実行(ユーザー指示の上で)
 *
 * 安全性:
 *   ・冪等(暗号化済はスキップ)。複数回流しても破壊しない。
 *   ・1 行ずつ encrypt → update なので、途中で落ちても次回続きから再開可能。
 *   ・トランザクションは張らない(行ごと独立)。
 *
 * 注意:
 *   ・本スクリプトを実行する前に DB マイグレーション
 *     20260628000006_add_encrypted_v2_columns.sql が適用済みであること。
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { encryptField } from "@/lib/crypto/field-encryption";

const BATCH_SIZE = 500;
// "v{n}:" プレフィックスを検出(暗号化済 判定)。マッチすればスキップ。
const ENCRYPTED_PREFIX_RE = /^v\d+:/;

type Target = {
  table: string;
  column: string;
  /** nullable な column はスキップしたいので NOT NULL フィルタを where に入れる */
  required: boolean;
};

const TARGETS: Target[] = [
  { table: "applications", column: "encrypted_details_v2", required: true },
  { table: "tasks", column: "encrypted_title_v2", required: true },
  { table: "tasks", column: "encrypted_description_v2", required: false },
  { table: "messages", column: "encrypted_content_v2", required: true },
];

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Required env ${name} is not set`);
  }
  return v;
}

async function backfillTable(target: Target): Promise<{
  scanned: number;
  encrypted: number;
  skipped: number;
  errors: number;
}> {
  const supabase = createSupabaseClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  let scanned = 0;
  let encrypted = 0;
  let skipped = 0;
  let errors = 0;

  // ID は uuid なので order by id でページング(offset を使わずに last seen id で進める)
  let lastId: string | null = null;

  while (true) {
    let query = supabase
      .from(target.table)
      .select(`id, ${target.column}`)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (target.required) {
      // NOT NULL は WHERE 不要(全部 値あり)
    } else {
      query = query.not(target.column, "is", null);
    }
    if (lastId) {
      query = query.gt("id", lastId);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`[backfill] ${target.table}.${target.column}: query failed`, error.message);
      break;
    }
    // Supabase の動的 select は ParserError を返す型推論になるため、unknown 経由でキャスト。
    const rows = (data as unknown as Array<Record<string, unknown>> | null) ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const id = row.id as string;
      const value = row[target.column];
      lastId = id;

      if (typeof value !== "string") {
        // null や非文字列はスキップ(REQUIRED でも初期値が無いケースがあり得る)
        skipped++;
        continue;
      }
      if (ENCRYPTED_PREFIX_RE.test(value)) {
        // 暗号化済
        skipped++;
        continue;
      }
      if (value.length === 0) {
        skipped++;
        continue;
      }

      try {
        const ciphertext = await encryptField(value);
        const { error: upErr } = await supabase
          .from(target.table)
          .update({ [target.column]: ciphertext })
          .eq("id", id);
        if (upErr) {
          console.error(
            `[backfill] ${target.table}.${target.column} id=${id} update failed:`,
            upErr.message,
          );
          errors++;
        } else {
          encrypted++;
        }
      } catch (e) {
        console.error(
          `[backfill] ${target.table}.${target.column} id=${id} encrypt threw:`,
          e instanceof Error ? e.message : String(e),
        );
        errors++;
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, encrypted, skipped, errors };
}

async function main(): Promise<void> {
  console.log("=== Field encryption backfill ===");
  console.log(`Supabase URL: ${getEnv("NEXT_PUBLIC_SUPABASE_URL")}`);
  console.log(`Targets: ${TARGETS.length}`);
  console.log("");

  for (const target of TARGETS) {
    process.stdout.write(`[${target.table}.${target.column}] processing ... `);
    const r = await backfillTable(target);
    console.log(
      `scanned=${r.scanned} encrypted=${r.encrypted} skipped=${r.skipped} errors=${r.errors}`,
    );
  }

  console.log("");
  console.log("Done.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
