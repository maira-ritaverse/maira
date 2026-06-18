import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * 機密フィールド AES-256-GCM バックフィル(運営者専用、一時エンドポイント)
 *
 * 役割:
 *   ・Vercel CLI で prod の FIELD_ENCRYPTION_KEYS を取得できない(secret マスク)
 *     ため、本番環境上で動くサーバサイドエンドポイントとして 用意。
 *   ・admin (isMairaAdmin) だけが叩ける。
 *   ・冪等(暗号化済みの行はスキップ)。
 *
 * バックフィル完了後、本ルート は 削除する予定(scripts/ に同等ロジックあり)。
 *
 * 使い方:
 *   ・運営者として /admin にログイン → POST /api/admin/internal/backfill-encryption
 *   ・例:fetch("/api/admin/internal/backfill-encryption", { method: "POST" })
 *
 * 安全性:
 *   ・service_role を 使うが、isMairaAdmin で 認可している
 *   ・全テーブル横断で 暗号化が 必要なのは v2 列のみ。bytea には触らない
 *   ・並列実行を 避けるため、各テーブルを 逐次処理する
 */

const BATCH_SIZE = 500;
const ENCRYPTED_PREFIX_RE = /^v\d+:/;

type Target = {
  table: string;
  column: string;
  required: boolean;
};

const TARGETS: Target[] = [
  { table: "applications", column: "encrypted_details_v2", required: true },
  { table: "tasks", column: "encrypted_title_v2", required: true },
  { table: "tasks", column: "encrypted_description_v2", required: false },
  { table: "messages", column: "encrypted_content_v2", required: true },
];

type Counts = {
  scanned: number;
  encrypted: number;
  skipped: number;
  errors: number;
};

async function backfillTable(target: Target): Promise<Counts> {
  const supabase = createServiceClient();
  const counts: Counts = { scanned: 0, encrypted: 0, skipped: 0, errors: 0 };
  let lastId: string | null = null;

  while (true) {
    let query = supabase
      .from(target.table)
      .select(`id, ${target.column}`)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (!target.required) {
      query = query.not(target.column, "is", null);
    }
    if (lastId) {
      query = query.gt("id", lastId);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`[backfill] ${target.table}.${target.column} query failed`, error.message);
      counts.errors++;
      break;
    }
    const rows = (data as unknown as Array<Record<string, unknown>> | null) ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      counts.scanned++;
      const id = row.id as string;
      const value = row[target.column];
      lastId = id;

      if (typeof value !== "string" || value.length === 0) {
        counts.skipped++;
        continue;
      }
      if (ENCRYPTED_PREFIX_RE.test(value)) {
        counts.skipped++;
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
            `[backfill] ${target.table}.${target.column} id=${id} update failed`,
            upErr.message,
          );
          counts.errors++;
        } else {
          counts.encrypted++;
        }
      } catch (e) {
        console.error(
          `[backfill] ${target.table}.${target.column} id=${id} encrypt threw`,
          e instanceof Error ? e.message : String(e),
        );
        counts.errors++;
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return counts;
}

/**
 * デプロイ直後の bytea → v2 キャッチアップ コピー。
 * マイグレーション 適用時 から 新コード デプロイ完了 までの 時間 (~数分) に
 * 旧コードが 書き込んだ bytea 行を v2 に コピー。すでに v2 に 値がある 行は
 * 触らない(冪等)。
 */
async function catchUpFromBytea(): Promise<{
  applications: number;
  tasks_title: number;
  tasks_description: number;
  messages: number;
}> {
  const supabase = createServiceClient();
  // postgres-meta 経由の SQL 実行は できないので、各テーブル ごとに 個別の rpc を
  // 用意するのは 大袈裟。代わりに、各 v2 が null の 行を SELECT して bytea を 読み、
  // 文字列に decode して v2 に 書き戻す。
  // bytea を Supabase JS から 取ると Uint8Array 等で 返るので TextDecoder で UTF-8 文字列化。

  const decoder = new TextDecoder("utf-8");
  const result = { applications: 0, tasks_title: 0, tasks_description: 0, messages: 0 };

  // applications.encrypted_details
  {
    const { data } = await supabase
      .from("applications")
      .select("id, encrypted_details")
      .is("encrypted_details_v2", null)
      .not("encrypted_details", "is", null)
      .limit(1000);
    for (const row of (data as unknown as Array<{ id: string; encrypted_details: unknown }>) ??
      []) {
      const text = decodeBytea(row.encrypted_details, decoder);
      if (text == null) continue;
      const { error } = await supabase
        .from("applications")
        .update({ encrypted_details_v2: text })
        .eq("id", row.id);
      if (!error) result.applications++;
    }
  }

  // tasks.encrypted_title
  {
    const { data } = await supabase
      .from("tasks")
      .select("id, encrypted_title")
      .is("encrypted_title_v2", null)
      .not("encrypted_title", "is", null)
      .limit(1000);
    for (const row of (data as unknown as Array<{ id: string; encrypted_title: unknown }>) ?? []) {
      const text = decodeBytea(row.encrypted_title, decoder);
      if (text == null) continue;
      const { error } = await supabase
        .from("tasks")
        .update({ encrypted_title_v2: text })
        .eq("id", row.id);
      if (!error) result.tasks_title++;
    }
  }

  // tasks.encrypted_description
  {
    const { data } = await supabase
      .from("tasks")
      .select("id, encrypted_description")
      .is("encrypted_description_v2", null)
      .not("encrypted_description", "is", null)
      .limit(1000);
    for (const row of (data as unknown as Array<{ id: string; encrypted_description: unknown }>) ??
      []) {
      const text = decodeBytea(row.encrypted_description, decoder);
      if (text == null) continue;
      const { error } = await supabase
        .from("tasks")
        .update({ encrypted_description_v2: text })
        .eq("id", row.id);
      if (!error) result.tasks_description++;
    }
  }

  // messages.encrypted_content
  {
    const { data } = await supabase
      .from("messages")
      .select("id, encrypted_content")
      .is("encrypted_content_v2", null)
      .not("encrypted_content", "is", null)
      .limit(5000);
    for (const row of (data as unknown as Array<{ id: string; encrypted_content: unknown }>) ??
      []) {
      const text = decodeBytea(row.encrypted_content, decoder);
      if (text == null) continue;
      const { error } = await supabase
        .from("messages")
        .update({ encrypted_content_v2: text })
        .eq("id", row.id);
      if (!error) result.messages++;
    }
  }

  return result;
}

/**
 * Supabase JS が 返す bytea の 各表現(\xHEX 文字列 / Uint8Array / base64 等)を
 * UTF-8 文字列に 復元する。lib/crypto/bytea.ts の byteaToText と同じ役割だが、
 * バックフィル 専用なので 簡略版を 内蔵する。
 */
function decodeBytea(value: unknown, decoder: TextDecoder): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      // \xHEX 形式 → Uint8Array → decode
      const hex = value.slice(2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }
      return decoder.decode(bytes);
    }
    return value;
  }
  if (value instanceof Uint8Array) return decoder.decode(value);
  if (Array.isArray(value)) return decoder.decode(new Uint8Array(value));
  return null;
}

export async function POST() {
  const isAdmin = await isMairaAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const catchUp = await catchUpFromBytea();

  const results: Record<string, Counts> = {};
  for (const target of TARGETS) {
    results[`${target.table}.${target.column}`] = await backfillTable(target);
  }

  return NextResponse.json({
    success: true,
    catchUp,
    backfill: results,
  });
}
