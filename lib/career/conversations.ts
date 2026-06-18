import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { careerProfileSchema, type CareerProfile, type StoredDiagnosis } from "./profile-schema";

/**
 * キャリア棚卸し用の会話/メッセージ操作ヘルパー
 *
 * 暗号化境界(2026-06-18 完了):
 *   - messages.encrypted_content_v2 (text):
 *       AES-256-GCM の "v{n}:base64url" 暗号文。旧 bytea カラム
 *       encrypted_content は触らない(マイグレーションで NOT NULL 解除済)。
 *       既存データのバックフィルは scripts/backfill-field-encryption.ts。
 *   - career_profiles.encrypted_data (text):
 *       既に AES-256-GCM 暗号化済み。v{n}:base64url 形式でテキスト列に格納。
 *       旧 bytea カラムと encryption_iv は DROP 済み。
 */

export type MessageForChat = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * 会話セッションを新規作成
 */
export async function createCareerConversation(userId: string): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      module: "career_inventory",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create conversation: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

/**
 * 会話の所有者・モジュール一致を確認
 *
 * RLSでもガードされるが、明示的に二重チェックする(防御的)。
 */
export async function verifyConversationOwner(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("user_id, module")
    .eq("id", conversationId)
    .single();

  if (error || !data) return false;
  if (data.user_id !== userId) return false;
  if (data.module !== "career_inventory") return false;

  return true;
}

/**
 * 会話の全メッセージを取得(時系列順)
 *
 * 復号は並列で進める(各レコード独立、I/O 待ち時間を圧縮)。
 * decryptField は v{n}:base64url 暗号文も、バックフィル前の平文も同じ I/F で返す。
 */
export async function getMessages(conversationId: string): Promise<MessageForChat[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages")
    .select("role, encrypted_content_v2")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return await Promise.all(
    (data ?? []).map(async (row) => ({
      role: row.role as MessageForChat["role"],
      content: (await decryptField(row.encrypted_content_v2 as string | null)) ?? "",
    })),
  );
}

/**
 * メッセージを保存(AES-256-GCM 暗号化)
 */
export async function saveMessage(params: {
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  const supabase = await createClient();

  const ciphertext = await encryptField(params.content);

  const { error: insertError } = await supabase.from("messages").insert({
    conversation_id: params.conversationId,
    user_id: params.userId,
    role: params.role,
    encrypted_content_v2: ciphertext,
    model_used: params.modelUsed,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
  });

  if (insertError) {
    throw new Error(`Failed to save message: ${insertError.message}`);
  }

  // conversations.message_count / last_message_at を更新
  // 並行更新時の整合性のため SQL関数で対応(なければフォールバック)
  const { error: rpcError } = await supabase.rpc("increment_conversation_message_count", {
    conversation_id_param: params.conversationId,
  });

  if (rpcError) {
    // RPC未適用環境向けのフォールバック:直接 update する
    // (message_count は厳密にカウントできないが last_message_at は更新できる)
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", params.conversationId);
  }
}

/**
 * ユーザーのキャリア棚卸し会話一覧を取得(最新更新順)
 */
export async function listCareerConversations(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, message_count, last_message_at, is_archived, created_at")
    .eq("user_id", userId)
    .eq("module", "career_inventory")
    .eq("is_archived", false)
    .order("last_message_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list conversations: ${error.message}`);
  }

  return data ?? [];
}

// ====================================================================
// career_profiles の CRUD ヘルパー
// 1ユーザー1レコードの想定。version は更新ごとにインクリメントする。
//
// Step 6 完了後の暗号化境界:
//   - 単一列 encrypted_data (text) に AES-256-GCM の "v{n}:base64url" 形式
//     暗号文を格納する。旧 bytea カラムと encryption_iv は DROP 済み。
//   - 書き込み:encryptField(JSON.stringify(merged))
//   - 読み出し:decryptField → JSON.parse → careerProfileSchema 検証
// ====================================================================

/**
 * career_profile の保存(upsert、1ユーザー1レコード)
 *
 * 注意:キャリア棚卸し AI(generate-profile)が呼ぶ経路。AI 出力には diagnosis が
 * 含まれないため、ここで既存レコードの diagnosis があれば「引き継ぐ」処理を入れる。
 * そうしないと、診断 → 棚卸しの順で利用したユーザーの診断結果が棚卸し再生成時に
 * 消えてしまう。
 */
export async function saveCareerProfile(userId: string, profile: CareerProfile): Promise<void> {
  const supabase = await createClient();

  // 既存レコードの diagnosis を保護するため、まず読み出してマージする。
  // profile に既に diagnosis が含まれている場合はそちらを優先する(明示上書きを尊重)。
  const existingProfile = await getCareerProfile(userId);
  const merged: CareerProfile =
    !profile.diagnosis && existingProfile?.profile.diagnosis
      ? { ...profile, diagnosis: existingProfile.profile.diagnosis }
      : profile;

  // Step 6:単一経路の暗号化書き込み。merged JSON を AES-256-GCM で暗号化し、
  // encrypted_data (text) に "v{n}:base64url" 形式で格納する。
  const ciphertext = await encryptField(JSON.stringify(merged));

  // 既存レコードがあるかチェック
  const { data: existing } = await supabase
    .from("career_profiles")
    .select("id, version")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    // 更新(version をインクリメント)
    const { error } = await supabase
      .from("career_profiles")
      .update({
        encrypted_data: ciphertext,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to update career profile: ${error.message}`);
    }
  } else {
    // 新規作成
    const { error } = await supabase.from("career_profiles").insert({
      user_id: userId,
      encrypted_data: ciphertext,
      version: 1,
    });

    if (error) {
      throw new Error(`Failed to create career profile: ${error.message}`);
    }
  }

  // 棚卸し更新を受けて AI 求人推薦のキャッシュを invalidate する。
  // 次回 /app/recommended-jobs を開いたときに hash mismatch で再計算されるが、
  // 明示的に無効化することで「キャッシュが古い理由」を明確にする。
  // 失敗してもユーザ操作は止めない(ベストエフォート)。
  try {
    await supabase.from("seeker_job_recommendations").delete().eq("user_id", userId);
  } catch (err) {
    console.warn("[career-profile-save] failed to invalidate seeker_job_recommendations", err);
  }
}

/**
 * 診断結果のみを career_profile に保存する。
 *
 * - 既存レコードがある:profile を読み込み、diagnosis だけ差し替えて再保存。
 * - 既存レコードが無い:診断より棚卸しを先にやらないユーザー向けに、棚卸し系
 *   フィールドを空のデフォルトで埋めたうえで保存する。後から棚卸しを行えば、
 *   saveCareerProfile 経由で棚卸し結果は埋まり、diagnosis は引き継がれる。
 *
 * 暗号化境界:career_profiles の encrypted_data に同梱する。saveCareerProfile と
 * 同じ書き込み経路を使うことで、本格暗号化導入時に一箇所だけ変えれば済むようにする。
 */
export async function saveDiagnosisResult(
  userId: string,
  diagnosis: StoredDiagnosis,
): Promise<void> {
  const existing = await getCareerProfile(userId);

  const merged: CareerProfile = existing
    ? { ...existing.profile, diagnosis }
    : {
        user_facts: {
          current_role: null,
          years_of_experience: null,
          industry: null,
          company_size: null,
        },
        strengths: [],
        values: [],
        wants: { industries: [], role_types: [], company_sizes: [] },
        concerns: [],
        summary: "",
        diagnosis,
      };

  await saveCareerProfile(userId, merged);
}

// ====================================================================
// career_profile 復号ヘルパー(本人経路 / エージェント経路で共有)
//
// Step 6 完了後:
//   - encrypted_data (text) は AES-256-GCM の "v{n}:base64url" 暗号文のみ
//   - 旧 bytea 経路 / dual-write / フォールバック分岐は撤去済み
//   - 経路は decryptField → JSON.parse → careerProfileSchema 検証 の単一経路
//
// 失敗時は明示ログ + null(getCareerProfile の従来挙動を維持)。
// 呼び出し側 17 箇所は null を「データ無し」として扱えるため、UI を crash
// させずに安全側に倒せる。
// ====================================================================
export async function decodeCareerProfileBlob(
  encryptedData: string | null,
): Promise<CareerProfile | null> {
  if (typeof encryptedData !== "string" || encryptedData.length === 0) {
    return null;
  }

  let jsonString: string;
  try {
    const plaintext = await decryptField(encryptedData);
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      console.error("career_profiles: decryptField returned non-string/empty", {
        type: typeof plaintext,
      });
      return null;
    }
    jsonString = plaintext;
  } catch (e) {
    // 鍵バージョン不一致 / GCM 認証タグ NG / 改竄など。
    console.error("career_profiles: decrypt failed", e);
    return null;
  }
  return parseAndValidateProfile(jsonString);
}

/**
 * JSON 文字列 → CareerProfile への変換とスキーマ検証。
 * 失敗時は console.error + null(getCareerProfile の従来挙動を維持)。
 */
function parseAndValidateProfile(jsonString: string): CareerProfile | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonString);
  } catch (e) {
    console.error("career_profiles: stored data is not valid JSON", e);
    return null;
  }

  const validated = careerProfileSchema.safeParse(parsedJson);
  if (!validated.success) {
    // セキュリティ:復号後の career_profile 全文(raw)も Zod issue
    // オブジェクト本体(received 値や message 内に PII が混入し得る)も
    // ログに出さない。フィールド位置の特定には path だけで十分。
    const paths = validated.error.issues.map((i) => i.path);
    if (paths.length > 0) {
      console.error("career_profiles: stored data does not match schema", { paths });
    } else {
      console.error("career_profiles: stored data does not match schema");
    }
    return null;
  }

  return validated.data;
}

/**
 * career_profile の取得
 *
 * Step 6 完了後:単一列 encrypted_data (text, 暗号文) を SELECT し、
 * decodeCareerProfileBlob で復号 → schema 検証 → 戻す。
 */
export async function getCareerProfile(
  userId: string,
): Promise<{ profile: CareerProfile; version: number; updatedAt: string } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("career_profiles")
    .select("encrypted_data, version, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch career profile: ${error.message}`);
  }

  if (!data) return null;

  const profile = await decodeCareerProfileBlob(data.encrypted_data);
  if (!profile) return null;

  return {
    profile,
    version: data.version,
    updatedAt: data.updated_at,
  };
}
