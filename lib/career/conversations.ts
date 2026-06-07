import { createClient } from "@/lib/supabase/server";
import { decryptField } from "@/lib/crypto/field-encryption";
import { careerProfileSchema, type CareerProfile, type StoredDiagnosis } from "./profile-schema";

/**
 * キャリア棚卸し用の会話/メッセージ操作ヘルパー
 *
 * 暗号化は未実装(Week 3で本実装)。
 * 暫定として平文のUTF-8バイト列を bytea カラムに格納する。
 * encryption_iv は暗号化前のためダミー(空 bytea)を入れる。
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
 */
export async function getMessages(conversationId: string): Promise<MessageForChat[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages")
    .select("role, encrypted_content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    role: row.role as MessageForChat["role"],
    content: bytesToText(row.encrypted_content),
  }));
}

/**
 * メッセージを保存
 * 暗号化なし版:UTF-8バイト列を bytea に保存
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

  const contentBytea = textToByteaInput(params.content);
  // 暗号化なし版のダミーIV(本実装で本物のIVに置き換える)
  const dummyIv = textToByteaInput("");

  const { error: insertError } = await supabase.from("messages").insert({
    conversation_id: params.conversationId,
    user_id: params.userId,
    role: params.role,
    encrypted_content: contentBytea,
    encryption_iv: dummyIv,
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
// バイト列とテキストの相互変換(暫定)
// Week 3 で AES-256-GCM の本物の暗号化に置き換える。
// ====================================================================

/**
 * テキストを PostgreSQL bytea 入力用の文字列に変換する。
 *
 * supabase-js は insert/update の値を JSON.stringify するため、Node の Buffer を
 * そのまま渡すと Buffer.toJSON() が呼ばれて `{"type":"Buffer","data":[...]}` という
 * オブジェクトに変換され、PostgREST はそのバイト列(=JSON文字列)を bytea に書き込む。
 * 結果として読み戻したデータが文字化けする。
 *
 * これを避けるため、bytea には PostgreSQL の bytea テキスト入力形式
 * `\x` + hex 文字列を渡す。supabase-js が文字列として送り、PostgreSQL 側が
 * bytea にデコードしてくれる。読み出し側の bytesToText は既に `\x` 対応済み。
 */
function textToByteaInput(text: string): string {
  return "\\x" + Buffer.from(text, "utf-8").toString("hex");
}

/**
 * Supabase が返す bytea を文字列に戻す
 *
 * supabase-js は bytea を以下のいずれかの形式で返す可能性がある:
 * 1. "\\x..." プレフィックス付きの16進数文字列(PostgREST デフォルト)
 * 2. Base64 文字列
 * 3. Uint8Array / Buffer
 */
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

  // 想定外の形式が来た場合は安全側に倒して空文字
  return "";
}

// ====================================================================
// career_profiles の CRUD ヘルパー
// 1ユーザー1レコードの想定。version は更新ごとにインクリメントする。
// 暗号化は未実装(Week 3で本実装、ここも encrypted_data に本物の暗号文を入れる)。
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

  // JSON文字列 → bytea テキスト入力形式(暗号化なし版)
  // saveMessage と同じ理由で Buffer ではなく \x hex 文字列を渡す。
  const dataBytea = textToByteaInput(JSON.stringify(merged));
  const dummyIv = textToByteaInput("");

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
        encrypted_data: dataBytea,
        encryption_iv: dummyIv,
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
      encrypted_data: dataBytea,
      encryption_iv: dummyIv,
      version: 1,
    });

    if (error) {
      throw new Error(`Failed to create career profile: ${error.message}`);
    }
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
// hybrid decode ヘルパー
//
// 暗号化移行期間中、career_profiles の本文を以下のいずれかから復元する:
//   - encrypted_data_v2 (text): "v{n}:base64url" 形式の本物の暗号文(Step 2 以降)
//   - encrypted_data   (bytea): 平文 JSON を bytea でラップしただけの暫定形式(現行)
//
// 優先順位は v2 → 旧 bytea。Step 1 時点では v2 列はまだ DB に無いため、
// 全行が旧 bytea 経路を通る(挙動不変)。
//
// 失敗時は getCareerProfile の従来挙動を保つ:握りつぶさず console.error で
// 明示ログ → null 返却。呼び出し側 17 箇所は既に null を「データ無し」として
// 扱えるため、UI を crash させずに安全側に倒せる。
// ====================================================================
export type CareerProfileBlobRow = {
  encrypted_data?: unknown;
  encrypted_data_v2?: string | null;
};

export async function decodeCareerProfileBlob(
  row: CareerProfileBlobRow,
): Promise<CareerProfile | null> {
  // v2 経路を優先:Step 2 で列追加・Step 3 で書き込み・Step 4 でバックフィル
  // が完了するに従い、こちらを通る行が増えていく。
  const v2 = row.encrypted_data_v2;
  if (typeof v2 === "string" && v2.length > 0) {
    let jsonString: string;
    try {
      const plaintext = await decryptField(v2);
      // 入力が non-empty string のため、戻りも string のはず。
      // 型ナローイングを越えてきたら破損データ扱いで安全側に倒す。
      if (typeof plaintext !== "string" || plaintext.length === 0) {
        console.error("career_profiles: decryptField returned non-string/empty", {
          type: typeof plaintext,
        });
        return null;
      }
      jsonString = plaintext;
    } catch (e) {
      // 鍵バージョン不一致 / GCM 認証タグ NG / 改竄など。
      // 現行の JSON.parse 失敗と同じく明示ログ + null で抜ける。
      console.error("career_profiles: decrypt failed", e);
      return null;
    }
    return parseAndValidateProfile(jsonString);
  }

  // 旧 bytea 経路(Step 1 時点では全行ここを通る)
  const jsonString = bytesToText(row.encrypted_data);
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
    console.error("career_profiles: stored data does not match schema", {
      issues: validated.error.issues,
      raw: parsedJson,
    });
    return null;
  }

  return validated.data;
}

/**
 * career_profile の取得
 *
 * Step 1: v2 列はまだ DB に存在しないため select には含めない。
 * decodeCareerProfileBlob は v2 未定義 → 旧 bytea 経路を通る(挙動不変)。
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

  const profile = await decodeCareerProfileBlob({ encrypted_data: data.encrypted_data });
  if (!profile) return null;

  return {
    profile,
    version: data.version,
    updatedAt: data.updated_at,
  };
}
