/**
 * LINE 会話一覧 / 個別履歴 の DB 取得 ヘルパー
 *
 * 会話 = (organization_id, line_user_id) 単位。
 * 一覧 は 最終 メッセージ 順 で 並べ替え。
 * 復号 は サーバ側 で 行い、 クライアント に は 平文 を 渡す
 * (RSC からの 呼び出し 前提)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField } from "@/lib/crypto/field-encryption";

export type ConversationListItem = {
  lineUserId: string;
  clientRecordId: string | null;
  clientName: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  unfollowedAt: string | null;
  handledAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  unreadCount: number;
  /** 最終 活動 時刻 (line_user_links.last_activity_at)。 「3 日 連絡 なし」 判定 用。 */
  lastActivityAt: string | null;
};

export type ConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  text: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  /** Storage に 保存済 の 添付 (画像 / 動画 / 音声 / ファイル) — 配信は 署名URL API 経由 */
  hasAttachment: boolean;
  /** 添付 メタ (file の 元 ファイル名 等) */
  attachmentFileName: string | null;
  sendMethod: "reply" | "push" | "multicast" | null;
  sendStatus: "queued" | "sent" | "failed" | null;
  createdAt: string;
  /** 構造化 system メッセージ の 種別 (例: "job_interest") */
  systemKind: string | null;
  /** 構造化 system メッセージ の メタ (UI で 色付き カード を 描画 する 際 に 使う) */
  systemMeta: {
    jobId?: string;
    companyName?: string;
    position?: string;
    senderDisplayName?: string;
  } | null;
};

/**
 * 自組織 の 全 会話 を 一覧。 最終 メッセージ 順。
 *
 * 内部実装:
 *   1) line_user_links で 全 友達 を 取得
 *   2) 各 友達 の 最終 line_messages 1 行 を 取得 (Promise.all)
 *   3) 一覧 マージ + ソート
 *
 * 規模 < 数百件 を 想定 (それ以上 は 後日 pagination 追加)。
 */
export async function listConversations(supabase: SupabaseClient): Promise<ConversationListItem[]> {
  const { data: linkData } = await supabase
    .from("line_user_links")
    .select(
      "line_user_id, client_record_id, display_name, custom_name, picture_url, unfollowed_at, handled_at, last_activity_at",
    );

  type LinkRow = {
    line_user_id: string;
    client_record_id: string | null;
    display_name: string | null;
    custom_name: string | null;
    picture_url: string | null;
    unfollowed_at: string | null;
    handled_at: string | null;
    last_activity_at: string | null;
  };
  const links = (linkData ?? []) as LinkRow[];

  // 各 lineUserId の 最終 メッセージ を 取得
  const conversations = await Promise.all(
    links.map(async (link) => {
      const { data: msgData } = await supabase
        .from("line_messages")
        .select(
          "id, direction, message_type, encrypted_content, sticker_package_id, sticker_id, created_at",
        )
        .eq("line_user_id", link.line_user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      type MsgRow = {
        id: string;
        direction: "inbound" | "outbound";
        message_type: string;
        encrypted_content: string | null;
        sticker_package_id: string | null;
        sticker_id: string | null;
        created_at: string;
      };
      const lastMessage = msgData as MsgRow | null;

      let preview: string | null = null;
      let direction: "inbound" | "outbound" | null = null;
      let lastAt: string | null = null;
      if (lastMessage) {
        direction = lastMessage.direction;
        lastAt = lastMessage.created_at;
        preview = await previewFor(lastMessage);
      }

      // 未読 件数 = direction=inbound かつ read_at IS NULL の 件数
      const { count: unreadRaw } = await supabase
        .from("line_messages")
        .select("id", { count: "exact", head: true })
        .eq("line_user_id", link.line_user_id)
        .eq("direction", "inbound")
        .is("read_at", null);

      return {
        lineUserId: link.line_user_id,
        clientRecordId: link.client_record_id,
        // 一覧 表示 は エージェント カスタム名 > LINE プロフィール名
        displayName: link.custom_name ?? link.display_name,
        pictureUrl: link.picture_url,
        unfollowedAt: link.unfollowed_at,
        handledAt: link.handled_at,
        lastMessageAt: lastAt,
        lastMessagePreview: preview,
        lastMessageDirection: direction,
        unreadCount: unreadRaw ?? 0,
        lastActivityAt: link.last_activity_at,
      };
    }),
  );

  // client_record name 一括 引き
  const clientRecordIds = Array.from(
    new Set(conversations.map((c) => c.clientRecordId).filter((v): v is string => v !== null)),
  );
  const clientNameMap = new Map<string, string>();
  if (clientRecordIds.length > 0) {
    const { data: clientRows } = await supabase
      .from("client_records")
      .select("id, name")
      .in("id", clientRecordIds);
    for (const c of (clientRows ?? []) as Array<{ id: string; name: string }>) {
      clientNameMap.set(c.id, c.name);
    }
  }

  return conversations
    .map((c) => ({
      ...c,
      clientName: c.clientRecordId ? (clientNameMap.get(c.clientRecordId) ?? null) : null,
    }))
    .sort((a, b) => {
      // 1) 未読あり が 先
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
      // 2) lastMessageAt 新しい が 先
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
}

/**
 * 個別 会話 の メッセージ履歴 を 取得。 古い順 で 返す (チャット 表示用)。
 */
export async function listConversationMessages(
  supabase: SupabaseClient,
  lineUserId: string,
  limit = 100,
): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from("line_messages")
    .select(
      "id, direction, message_type, encrypted_content, sticker_package_id, sticker_id, attachment_storage_path, send_method, send_status, created_at",
    )
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  type Row = {
    id: string;
    direction: "inbound" | "outbound";
    message_type: string;
    encrypted_content: string | null;
    sticker_package_id: string | null;
    sticker_id: string | null;
    attachment_storage_path: string | null;
    send_method: "reply" | "push" | "multicast" | null;
    send_status: "queued" | "sent" | "failed" | null;
    created_at: string;
  };

  // 復号 を 並列
  const rows = data as Row[];
  const decoded = await Promise.all(
    rows.map(async (r) => {
      const decryptedText = r.encrypted_content ? await decryptField(r.encrypted_content) : null;
      // image / video / audio / file は encrypted_content に メタJSON が 入る ので
      // テキスト として 復号 した 結果 を JSON parse して 表示用 に 整形 する
      let displayText: string | null = decryptedText;
      let fileName: string | null = null;
      let systemKind: string | null = null;
      let systemMeta: {
        jobId?: string;
        companyName?: string;
        position?: string;
        senderDisplayName?: string;
      } | null = null;
      if (
        decryptedText &&
        (r.message_type === "image" ||
          r.message_type === "video" ||
          r.message_type === "audio" ||
          r.message_type === "file")
      ) {
        try {
          const meta = JSON.parse(decryptedText) as { fileName?: string };
          fileName = meta.fileName ?? null;
          // 添付 系 は チャット本文 を 空に (UI は file タグ等 で 表示)
          displayText = null;
        } catch {
          // JSON でない なら そのまま 表示
        }
      } else if (decryptedText && r.message_type === "system") {
        // 構造化 system メッセージ (例: "job_interest") を JSON parse 試行。
        // 失敗 (旧形式 の プレーン テキスト) なら そのまま 表示。
        try {
          const meta = JSON.parse(decryptedText) as {
            kind?: string;
            jobId?: string;
            companyName?: string;
            position?: string;
            senderDisplayName?: string;
            text?: string;
          };
          if (meta && typeof meta === "object" && meta.kind) {
            systemKind = meta.kind;
            systemMeta = {
              jobId: meta.jobId,
              companyName: meta.companyName,
              position: meta.position,
              senderDisplayName: meta.senderDisplayName,
            };
            displayText = meta.text ?? null;
          }
        } catch {
          // プレーン テキスト の system メッセージ
        }
      }
      return {
        id: r.id,
        direction: r.direction,
        messageType: r.message_type,
        text: displayText,
        stickerPackageId: r.sticker_package_id,
        stickerId: r.sticker_id,
        hasAttachment: r.attachment_storage_path !== null,
        attachmentFileName: fileName,
        sendMethod: r.send_method,
        sendStatus: r.send_status,
        createdAt: r.created_at,
        systemKind,
        systemMeta,
      };
    }),
  );

  // 取得 は 新しい順 だが、 UI は 古い順 で 表示 する ため reverse
  return decoded.reverse();
}

/**
 * inbound メッセージ の read_at を 一括更新 (会話 を 開いた タイミング)。
 * service_role 必要 なので 呼び出し側 で service client を 渡す。
 */
export async function markConversationRead(
  service: SupabaseClient,
  organizationId: string,
  lineUserId: string,
): Promise<void> {
  await service
    .from("line_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("line_user_id", lineUserId)
    .eq("direction", "inbound")
    .is("read_at", null);
}

// ============================================================
// 内部 ヘルパー
// ============================================================

async function previewFor(row: {
  message_type: string;
  encrypted_content: string | null;
  sticker_id: string | null;
}): Promise<string> {
  if (row.message_type === "text" && row.encrypted_content) {
    const text = await decryptField(row.encrypted_content);
    if (!text) return "(復号失敗)";
    return text.length > 40 ? text.slice(0, 40) + "..." : text;
  }
  switch (row.message_type) {
    case "sticker":
      return "[スタンプ]";
    case "image":
      return "[画像]";
    case "video":
      return "[動画]";
    case "audio":
      return "[音声]";
    case "file":
      return "[ファイル]";
    case "location":
      return "[位置情報]";
    case "flex":
    case "template":
      return "[リッチメッセージ]";
    case "system": {
      if (!row.encrypted_content) return "[システム]";
      const decoded = (await decryptField(row.encrypted_content)) ?? "[システム]";
      // 構造化 system (kind:"job_interest" 等) は text 部分 を 抜き出し、 ★ で 強調
      try {
        const parsed = JSON.parse(decoded) as { kind?: string; text?: string };
        if (parsed.kind === "job_interest") {
          const txt = parsed.text ?? "興味あり";
          return `★ ${txt.length > 38 ? txt.slice(0, 38) + "..." : txt}`;
        }
        if (parsed.text) return parsed.text;
      } catch {
        // プレーン テキスト の system
      }
      return decoded;
    }
    default:
      return `[${row.message_type}]`;
  }
}
