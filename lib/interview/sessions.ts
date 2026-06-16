/**
 * 面接シミュレーターセッションの型 + クエリヘルパ
 *
 * メッセージは AES-256-GCM(lib/crypto/field-encryption)で暗号化保存。
 * セッション総評(summary)も同方式。
 */
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";

export type InterviewPositionContext = {
  companyName?: string;
  position?: string;
  requiredSkills?: string;
};

export type InterviewSession = {
  id: string;
  userId: string;
  positionContext: InterviewPositionContext;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  createdAt: string;
};

export type InterviewMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  position_context: unknown;
  started_at: string;
  completed_at: string | null;
  encrypted_summary: string | null;
  created_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  encrypted_content: string;
  created_at: string;
};

async function rowToSession(row: SessionRow): Promise<InterviewSession> {
  const ctx = (row.position_context ?? {}) as InterviewPositionContext;
  const summary = row.encrypted_summary ? await decryptField(row.encrypted_summary) : null;
  return {
    id: row.id,
    userId: row.user_id,
    positionContext: ctx,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    summary,
    createdAt: row.created_at,
  };
}

async function rowToMessage(row: MessageRow): Promise<InterviewMessage> {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as "user" | "assistant",
    content: (await decryptField(row.encrypted_content)) ?? "",
    createdAt: row.created_at,
  };
}

/** 1 セッション + 全メッセージを復号して返す(本人チェックを呼び出し側で担保) */
export async function getInterviewSessionWithMessages(
  sessionId: string,
): Promise<{ session: InterviewSession; messages: InterviewMessage[] } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: sRow } = await supabase
    .from("interview_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sRow) return null;

  const { data: mRows } = await supabase
    .from("interview_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const session = await rowToSession(sRow as SessionRow);
  const messages = await Promise.all(((mRows ?? []) as MessageRow[]).map(rowToMessage));
  return { session, messages };
}

/** メッセージを 1 件保存(server-only) */
export async function saveInterviewMessage(input: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<void> {
  const supabase = await createClient();
  const encrypted = await encryptField(input.content);
  if (!encrypted) return;
  await supabase.from("interview_messages").insert({
    session_id: input.sessionId,
    role: input.role,
    encrypted_content: encrypted,
  });
}
