/**
 * アプリ内通知(in_app)発火・型定義
 *
 * notifications テーブルは encrypted_payload (text) に
 * lib/crypto/field-encryption.ts の "v{n}:base64url" 形式で
 * JSON 文字列を保存する。受信者ごとに 1 行(同じ暗号文を共有して可)。
 *
 * 注意:
 * - 本ファイルの fire 系関数は service_role を使う(notifications の RLS は
 *   INSERT ポリシーを持たないため。SELECT/UPDATE は本人だけに残してある)。
 *   したがって server 専用。必ず呼び出し側で「誰に何を通知するか」の権限判定を
 *   済ませてから呼ぶこと。本関数自体はテナント境界の判定はしない。
 * - ペイロードに「求職者の内面情報(career_profile の中身、メモ、本人にしか
 *   見えない wants 等)」は決して含めない。同組織アドバイザーが共有してよい
 *   範囲(表示名・進捗ステータス・参照ID・遷移元/先)に限定する。
 */

import { encryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * 通知ペイロードの kind 文字列。
 * DB の notification_kind enum とは別。enum は「カテゴリ」、こちらは
 * UI 側で表示分岐するための「具体イベント名」。同じ application_followup
 * カテゴリの中で referral_status_change, referral_created, ... が
 * 並ぶ想定。
 */
export type InAppPayload = ReferralStatusChangePayload;

export type ReferralStatusChangePayload = {
  kind: "referral_status_change";
  /** UI に出すヘッドライン(例:「面接 → 内定: 山田太郎さん」)。クリック前の一覧表示用。 */
  title: string;
  /** クリック時の遷移先(エージェント側パス)。 */
  href: string;
  referralId: string;
  clientRecordId: string;
  /** 表示用。求職者の内面情報は含めない方針(name のみ)。 */
  clientName: string;
  /** 初回遷移(null)もあり得る。 */
  fromStatus: string | null;
  toStatus: string;
  /** 変更したアドバイザーの表示名。未設定なら null。 */
  actorDisplayName: string | null;
};

type FireParams = {
  organizationId: string;
  /** 通知を送らないユーザー(変更操作の実行者本人)。 */
  excludeUserId: string;
  payload: InAppPayload;
};

/**
 * 同組織メンバー全員(変更者本人を除く)に in_app 通知を 1 件ずつ INSERT する。
 *
 * 設計判断:
 * - 送信先 N 人分の行を別々に作る(共有テーブルではない)。理由:notifications の
 *   user_id ベース RLS をそのまま使うため。同じ暗号文を共有するので冗長性は
 *   text 数百バイト × N で実用上問題なし。
 * - 暗号化は 1 回(全員同じペイロード)。
 * - 失敗は throw せず console.error にとどめる。呼び出し側は try/catch 不要で
 *   良い設計だが、呼び出し側で更に try/catch する想定の場合に備えて throw しない。
 */
export async function fireInAppNotification(params: FireParams): Promise<void> {
  const service = createServiceClient();

  // 1. 同 org メンバーの user_id を取得(変更者本人は後段で除外)
  const { data: members, error: membersErr } = await service
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", params.organizationId);

  if (membersErr) {
    console.error("[notifications] failed to load org members", {
      organizationId: params.organizationId,
      message: membersErr.message,
    });
    return;
  }

  const recipients = (members ?? [])
    .map((m) => m.user_id as string)
    .filter((uid) => uid && uid !== params.excludeUserId);

  if (recipients.length === 0) return;

  // 2. 暗号化(全員に同じ暗号文を配るので 1 回)
  const ciphertext = await encryptField(JSON.stringify(params.payload));
  if (!ciphertext) {
    // encryptField は空文字以外を渡せば必ず非空を返す契約。ここに来たら異常系。
    console.error("[notifications] encryptField returned empty", { kind: params.payload.kind });
    return;
  }

  // 3. 一括 INSERT。kind は notification_kind enum の "application_followup"
  //    (本ペイロードの kind: "referral_status_change" は UI 分岐用、別軸)。
  const now = new Date().toISOString();
  const rows = recipients.map((userId) => ({
    user_id: userId,
    kind: "application_followup" as const,
    channel: "in_app" as const,
    encrypted_payload: ciphertext,
    scheduled_at: now,
    // in_app は配信先がアプリ内なので、書き込み = 配信完了と見なす。
    sent_at: now,
  }));

  const { error: insertErr } = await service.from("notifications").insert(rows);
  if (insertErr) {
    console.error("[notifications] insert failed", {
      organizationId: params.organizationId,
      recipientCount: recipients.length,
      message: insertErr.message,
    });
  }
}
