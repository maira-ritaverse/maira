import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getModel, MODELS } from "@/lib/ai/client";
import { decryptField } from "@/lib/crypto/field-encryption";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/conversations/[lineUserId]/ai-suggest
 *
 * LINE 会話 履歴 を Claude に 渡し、
 *   ・「次 の ステップ の 見立て」
 *   ・「返信 案 (1 案 のみ)」
 * を JSON で 返す。
 *
 * 認可:
 *   ・requireOrgMember。 line_user_links.organization_id と 一致 確認 で 二重 防御
 *   ・AI 月次 上限 (organization scope) を checkAiUsageLimit で 前 チェック
 *   ・成功 時 に recordAiUsage で 1 件 消費
 *
 * 復号 は 復号 済み テキスト を Anthropic に 送信 → 応答 を 平文 で 返す。
 * 平文 は DB に 保存 せず、 admin が コピー or 手動 送信 する 想定。
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ lineUserId: string }> };

const HISTORY_LIMIT = 30; // 直近 30 件 の 会話 を コンテキスト に

const SUGGEST_SCHEMA = z.object({
  next_step: z
    .string()
    .describe("この 会話 の 次 の ステップ の 見立て を 1〜2 文 で 日本語 で 書く。"),
  reply_text: z
    .string()
    .describe(
      "エージェント として 顧客 に 送る 返信 案 の 本文。 日本語、 敬語、 LINE メッセージ として 自然 な 長さ (2〜5 文)。 冒頭 挨拶 の 「〜さん」 等 の 名前 は 顧客 の 表示 名 を 使う。",
    ),
});

const SYSTEM_PROMPT = `あなたは 人材 紹介 会社 の エージェント の コミュニケーション を 支援 する AI アシスタント。
公式 LINE で エージェント が 顧客 (求職者) と やり取り する 会話 履歴 を 読み、
- 「次 の ステップ」 の 現実 的 な 見立て
- 「返信 案」 (エージェント として 送る 本文)
を 提案 する。

方針:
- 顧客 の 温度 感 と 会話 の 文脈 を 読み解く
- 押し 売り 感 の ない 誠実 な トーン
- 面談 の 予約 / 求人 の 提案 / 質問 の 返答 など、 次 に 進む べき 具体 的 な アクション を 提示
- 顧客 が 未 レス で 数 日 経過 して いる 場合 は 押し つけ ず に 気遣い の 一 文 を 入れる
- 事実 が 不明 な こと は 断定 しない (「もし ご 都合 良ければ」 等 の 打診 表現)
`;

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;

  const { lineUserId: raw } = await context.params;
  const lineUserId = decodeURIComponent(raw);

  // organization_id 一致 の 二重 防御 (RLS 経由 + code)
  const { data: linkRow } = await supabase
    .from("line_user_links")
    .select("line_user_id, display_name, custom_name, client_record_id")
    .eq("organization_id", organization.id)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (!linkRow) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }
  const link = linkRow as {
    line_user_id: string;
    display_name: string | null;
    custom_name: string | null;
    client_record_id: string | null;
  };
  const displayName = link.custom_name ?? link.display_name ?? "(名前 なし)";

  // 会話 履歴 の 取得 (最新 順 → 逆 順 で timeline)
  const admin = createServiceClient();
  const { data: msgRows, error: msgErr } = await admin
    .from("line_messages")
    .select("id, direction, message_type, encrypted_content, created_at")
    .eq("organization_id", organization.id)
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (msgErr) {
    return NextResponse.json({ error: "history_fetch_failed" }, { status: 500 });
  }
  type MsgRow = {
    id: string;
    direction: "inbound" | "outbound";
    message_type: string;
    encrypted_content: string | null;
    created_at: string;
  };
  const messages = (msgRows ?? []) as MsgRow[];
  if (messages.length === 0) {
    return NextResponse.json(
      { error: "no_messages", message: "この 会話 に は まだ メッセージ が ありません。" },
      { status: 400 },
    );
  }

  // 復号 (失敗 は 該当 メッセージ を スキップ)
  const decrypted = await Promise.all(
    messages.reverse().map(async (m) => {
      const text = m.encrypted_content ? await decryptField(m.encrypted_content) : null;
      return { direction: m.direction, text, createdAt: m.created_at, type: m.message_type };
    }),
  );

  // AI 月次 上限 チェック
  const usage = await checkAiUsageLimit(supabase, user.id, "agency_line_reply_suggest");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "ai_limit_exceeded",
        message: `今月 の AI 上限 (${usage.limit} 回) に 達しました。 次 回 リセット: ${usage.resetsAt}`,
        usage,
      },
      { status: 402 },
    );
  }

  // Claude に 投げる (structured output)
  const historyText = decrypted
    .filter((m) => m.text)
    .map(
      (m) =>
        `[${new Date(m.createdAt).toLocaleString("ja-JP")}] ${m.direction === "inbound" ? `顧客 (${displayName})` : "エージェント"}: ${m.text}`,
    )
    .join("\n");

  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      system: SYSTEM_PROMPT,
      prompt: `以下 は これ まで の 会話 履歴 です。 次 の 行動 と 返信 案 を JSON で 返し て ください。

## 顧客 表示 名
${displayName}

## 会話 履歴 (時系列 順)
${historyText}
`,
      schema: SUGGEST_SCHEMA,
    });

    // 成功 → 使用 回数 を 記録
    await recordAiUsage(supabase, user.id, "agency_line_reply_suggest");

    return NextResponse.json({
      ok: true,
      nextStep: result.object.next_step,
      replyText: result.object.reply_text,
      usage: {
        limit: usage.limit,
        current: usage.current + 1,
        resetsAt: usage.resetsAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "ai_generation_failed", message: msg }, { status: 502 });
  }
}
