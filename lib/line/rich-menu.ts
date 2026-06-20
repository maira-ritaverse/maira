/**
 * Rich Menu 切替 (連携 状態 に 応じて)
 *
 * 呼出 タイミング:
 *   ・連携コード 消費 後 (handleMessage 内)
 *   ・手動 紐付け 完了 後 (API ハンドラ から)
 *   ・解除 時 は デフォルトに 戻す (linked_rich_menu_id の 個別 設定 を 解除)
 *
 * 失敗 は 致命的 でない (UI は 動作 する) ので 握り潰し + warn ログ。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { linkRichMenuToUser, unlinkRichMenuFromUser } from "./api";

/**
 * line_user_id が 紐付け 状態 に なった 時 に 呼ぶ。
 * linked_rich_menu_id が 設定 されて いれば、 その ユーザー に 個別 適用。
 */
export async function applyLinkedRichMenu(
  service: SupabaseClient,
  organizationId: string,
  lineUserId: string,
): Promise<void> {
  try {
    const { data } = await service
      .from("line_channels")
      .select("linked_rich_menu_id, line_channel_access_token_encrypted")
      .eq("organization_id", organizationId)
      .maybeSingle();
    const row = data as {
      linked_rich_menu_id: string | null;
      line_channel_access_token_encrypted: string;
    } | null;
    if (!row?.linked_rich_menu_id) return;

    const { decryptField } = await import("@/lib/crypto/field-encryption");
    const accessToken = await decryptField(row.line_channel_access_token_encrypted);
    if (!accessToken) return;

    const result = await linkRichMenuToUser(accessToken, lineUserId, row.linked_rich_menu_id);
    if (!result.ok) {
      console.warn("[line/rich-menu] link failed", {
        organizationId,
        lineUserId,
        status: result.status,
        message: result.message,
      });
    }
  } catch (err) {
    console.warn("[line/rich-menu] threw", err);
  }
}

/**
 * 紐付け 解除 時 に 呼ぶ。 デフォルト Rich Menu に 戻す (個別設定 を 解除)。
 */
export async function applyUnlinkedRichMenu(
  service: SupabaseClient,
  organizationId: string,
  lineUserId: string,
): Promise<void> {
  try {
    const { data } = await service
      .from("line_channels")
      .select("line_channel_access_token_encrypted")
      .eq("organization_id", organizationId)
      .maybeSingle();
    const row = data as { line_channel_access_token_encrypted: string } | null;
    if (!row) return;

    const { decryptField } = await import("@/lib/crypto/field-encryption");
    const accessToken = await decryptField(row.line_channel_access_token_encrypted);
    if (!accessToken) return;

    const result = await unlinkRichMenuFromUser(accessToken, lineUserId);
    if (!result.ok) {
      console.warn("[line/rich-menu] unlink failed", {
        organizationId,
        lineUserId,
        status: result.status,
        message: result.message,
      });
    }
  } catch (err) {
    console.warn("[line/rich-menu] threw", err);
  }
}
