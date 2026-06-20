/**
 * Advisor チャット (求職者 ↔ エージェント DM) の 型 定義
 *
 * テーブル:
 *   ・advisor_threads     スレッド (client_records 1 件 に つき 1 thread)
 *   ・advisor_messages    本文 は AES-256-GCM 暗号化 (text 形式)
 *
 * 「LINE 連携 して いない 求職者 と も アプリ 内 で やり取り」する 目的 で 用意。
 */
import { z } from "zod";

export type AdvisorSenderKind = "seeker" | "agency";

/**
 * advisor_threads 行 を 復号 / 整形 した 表示 用 型
 */
export type AdvisorThreadView = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  seekerUserId: string;
  lastMessageAt: string | null;
  unreadForSeeker: number;
  unreadForAgency: number;
  createdAt: string;
  /** プレビュー 用 に 最後 の メッセージ を 1 件 復号 して 添える (一覧画面) */
  lastMessagePreview?: string | null;
  /** エージェント 側 一覧 で 表示 する 相手 情報 (任意) */
  counterpartDisplayName?: string | null;
};

export type AdvisorMessageView = {
  id: string;
  threadId: string;
  senderKind: AdvisorSenderKind;
  senderUserId: string;
  /** 復号 済 本文 */
  content: string;
  readAt: string | null;
  createdAt: string;
};

// ============================================
// API バリデーション
// ============================================

/**
 * POST /api/agency/advisor/threads
 *   { clientRecordId } → thread を 取得 or 新規 作成
 */
export const createThreadSchema = z.object({
  clientRecordId: z.string().uuid(),
});
export type CreateThreadRequest = z.infer<typeof createThreadSchema>;

/**
 * POST /api/{app|agency}/advisor/threads/[id]/messages
 *   { content } メッセージ 本文 (平文、 サーバ側 で 暗号化 + 保存)
 */
export const postMessageSchema = z.object({
  content: z.string().min(1, "本文 を 入力 して ください").max(5000, "本文 は 5000 文字 以内"),
});
export type PostMessageRequest = z.infer<typeof postMessageSchema>;
