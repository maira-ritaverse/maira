/**
 * 推薦文(recommendation_letters)と推薦文テンプレートのクエリヘルパー
 *
 * 役割:
 *   ・暗号化境界を本ファイルに閉じ込める(API ルート / 画面側は平文だけを扱う)
 *   ・テンプレートは平文(機密情報を含まない)なので暗号化なし
 *
 * RLS により呼び出し元ユーザーの所属組織に絞り込まれるが、二重防御で
 * organization_id でのフィルタも明示的に書く(referrals/queries.ts と同じ作法)。
 */

import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";

import {
  type RecommendationLetter,
  type RecommendationLetterRow,
  type RecommendationLetterStatus,
  type RecommendationLetterSummary,
  type RecommendationLetterTemplate,
  type RecommendationLetterTemplateRow,
  rowToRecommendationLetterSummary,
  rowToRecommendationLetterTemplate,
} from "./types";

// ===========================================================================
// 暗号化 / 復号:ローカルマッパー
//
// 本文と件名は AES-256-GCM で個別に暗号化されているので、復号も並列で行う。
// (Promise.all で実行することで I/O 的にもネックを最小化)
// ===========================================================================

async function decryptLetterRow(row: RecommendationLetterRow): Promise<RecommendationLetter> {
  const [body, headline] = await Promise.all([
    decryptField(row.encrypted_body),
    decryptField(row.encrypted_headline),
  ]);
  return {
    id: row.id,
    organizationId: row.organization_id,
    referralId: row.referral_id,
    version: row.version,
    status: row.status as RecommendationLetterStatus,
    body,
    headline,
    templateId: row.template_id,
    createdByMemberId: row.created_by_member_id,
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ===========================================================================
// 推薦文:取得系
// ===========================================================================

/**
 * referral に紐づく推薦文の履歴(新しい順)を返す。
 *
 * 履歴一覧は本文を全件復号する必要が無いので、軽量な Summary を返す。
 * 本文編集画面に入ったときに getLetter で 1 件だけ復号する設計。
 */
export async function listLettersByReferral(
  referralId: string,
  organizationId: string,
): Promise<RecommendationLetterSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendation_letters")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("referral_id", referralId)
    .order("version", { ascending: false });

  if (error || !data) return [];
  return (data as RecommendationLetterRow[]).map(rowToRecommendationLetterSummary);
}

/**
 * 1 件取得(本文 / 件名を復号する)
 */
export async function getLetter(
  letterId: string,
  organizationId: string,
): Promise<RecommendationLetter | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendation_letters")
    .select("*")
    .eq("id", letterId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return decryptLetterRow(data as RecommendationLetterRow);
}

/**
 * referral に紐づく「最新版」を取得。
 * UI 入口で「未作成 / v{n} を編集」を出し分ける用途。
 */
export async function getLatestLetterSummary(
  referralId: string,
  organizationId: string,
): Promise<RecommendationLetterSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendation_letters")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("referral_id", referralId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToRecommendationLetterSummary(data as RecommendationLetterRow);
}

/**
 * 複数 referral に対応する「最新版サマリ」を一括取得して Map で返す。
 * クライアント詳細画面で referrals[] を一覧表示するときに N+1 を避けるため。
 */
export async function listLatestLetterSummariesByReferralIds(
  referralIds: string[],
  organizationId: string,
): Promise<Map<string, RecommendationLetterSummary>> {
  const result = new Map<string, RecommendationLetterSummary>();
  if (referralIds.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendation_letters")
    .select("*")
    .eq("organization_id", organizationId)
    .in("referral_id", referralIds)
    .order("version", { ascending: false });

  if (error || !data) return result;

  // version desc で並んでいるので、各 referral_id について最初に出てきたものが最新版。
  for (const row of data as RecommendationLetterRow[]) {
    if (!result.has(row.referral_id)) {
      result.set(row.referral_id, rowToRecommendationLetterSummary(row));
    }
  }
  return result;
}

// ===========================================================================
// 推薦文:作成 / 更新 / 確定 / 削除
// ===========================================================================

export type CreateLetterParams = {
  referralId: string;
  organizationId: string;
  memberId: string;
  headline: string;
  body: string;
  templateId: string | null;
};

/**
 * 新規バージョンを作成して返す。
 *
 * version は「(referral_id, version) UNIQUE」を満たすように
 * その referral の max+1 を採番。同時 POST で衝突したら unique 違反(23505)
 * になるので最大 3 回まで指数バックオフ(50ms / 100ms / 200ms)でリトライする。
 *
 * encryptField は body / headline を Promise.all で並列実行する
 * (各々 Web Crypto の subtle.encrypt 呼び出しで非同期だが、I/O 待ちを減らせる)。
 */
export async function createLetter(
  params: CreateLetterParams,
): Promise<RecommendationLetter | { error: string }> {
  const supabase = await createClient();

  const [encryptedBody, encryptedHeadline] = await Promise.all([
    encryptField(params.body),
    encryptField(params.headline),
  ]);

  // encryptField は空文字を空文字のままパススルーする実装になっているが、
  // DB の encrypted_body / encrypted_headline は NOT NULL なので
  // null/undefined にならないことを明示的に保証する(空文字 → 空文字、OK)。
  const safeBody = encryptedBody ?? "";
  const safeHeadline = encryptedHeadline ?? "";

  const MAX_RETRY = 3;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    // max(version) を取って +1。0 件なら 1 から開始。
    const { data: maxRow } = await supabase
      .from("recommendation_letters")
      .select("version")
      .eq("organization_id", params.organizationId)
      .eq("referral_id", params.referralId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = ((maxRow?.version as number | undefined) ?? 0) + 1;

    const { data, error } = await supabase
      .from("recommendation_letters")
      .insert({
        organization_id: params.organizationId,
        referral_id: params.referralId,
        version: nextVersion,
        status: "draft",
        encrypted_body: safeBody,
        encrypted_headline: safeHeadline,
        template_id: params.templateId,
        created_by_member_id: params.memberId,
      })
      .select("*")
      .single();

    if (!error && data) {
      return decryptLetterRow(data as RecommendationLetterRow);
    }

    lastError = error?.message ?? "Unknown error";

    // 23505 = unique violation。version 衝突のみリトライ。
    if (error?.code !== "23505") {
      return { error: lastError };
    }

    // 指数バックオフ:50ms / 100ms / 200ms
    await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
  }

  return { error: `Failed to allocate version after ${MAX_RETRY} retries: ${lastError}` };
}

export type UpdateLetterParams = {
  letterId: string;
  organizationId: string;
  headline?: string;
  body?: string;
  templateId?: string | null;
  status?: RecommendationLetterStatus;
};

/**
 * 部分更新。finalized 化のときは finalized_at もまとめてセットする。
 *
 * すでに finalized 済の letter を編集しようとしたら 409 相当のエラーを返す
 * (アプリ層で弾く設計 / DB に check 制約は付けていない)。
 */
export async function updateLetter(
  params: UpdateLetterParams,
): Promise<RecommendationLetter | { error: string; code?: string }> {
  const supabase = await createClient();

  // 現状を取得して finalized 済かを確認
  const { data: current, error: getErr } = await supabase
    .from("recommendation_letters")
    .select("*")
    .eq("id", params.letterId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (getErr || !current) {
    return { error: "Not found", code: "not_found" };
  }

  const currentRow = current as RecommendationLetterRow;
  if (currentRow.status === "finalized") {
    return { error: "確定済の推薦文は編集できません", code: "already_finalized" };
  }

  const update: Record<string, unknown> = {};

  // 暗号化は更新対象だけ並列で行う(空のフィールドは触らない)
  const tasks: Promise<void>[] = [];
  if (params.body !== undefined) {
    tasks.push(
      encryptField(params.body).then((v) => {
        update.encrypted_body = v ?? "";
      }),
    );
  }
  if (params.headline !== undefined) {
    tasks.push(
      encryptField(params.headline).then((v) => {
        update.encrypted_headline = v ?? "";
      }),
    );
  }
  await Promise.all(tasks);

  if (params.templateId !== undefined) {
    update.template_id = params.templateId;
  }
  if (params.status !== undefined) {
    update.status = params.status;
    if (params.status === "finalized") {
      update.finalized_at = new Date().toISOString();
    }
  }

  if (Object.keys(update).length === 0) {
    // 変更点ゼロなら現状をそのまま返す
    return decryptLetterRow(currentRow);
  }

  const { data, error } = await supabase
    .from("recommendation_letters")
    .update(update)
    .eq("id", params.letterId)
    .eq("organization_id", params.organizationId)
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to update" };
  }
  return decryptLetterRow(data as RecommendationLetterRow);
}

/**
 * 削除(admin のみ、RLS でも保証されている)
 */
export async function deleteLetter(
  letterId: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("recommendation_letters")
    .delete()
    .eq("id", letterId)
    .eq("organization_id", organizationId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ===========================================================================
// テンプレート:CRUD
// ===========================================================================

/**
 * 組織のテンプレ一覧(更新日時降順)
 */
export async function listTemplates(
  organizationId: string,
): Promise<RecommendationLetterTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendation_letter_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];
  return (data as RecommendationLetterTemplateRow[]).map(rowToRecommendationLetterTemplate);
}

export async function getTemplate(
  templateId: string,
  organizationId: string,
): Promise<RecommendationLetterTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendation_letter_templates")
    .select("*")
    .eq("id", templateId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToRecommendationLetterTemplate(data as RecommendationLetterTemplateRow);
}
