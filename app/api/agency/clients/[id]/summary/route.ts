import { NextResponse } from "next/server";
import { streamText } from "ai";
import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import {
  AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT,
  buildAgencyClientSummaryPrompt,
} from "@/lib/ai/prompts/agency-summary";
import { listTasksByClient } from "@/lib/agency-tasks/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { getDisclosableProfileForLinkedClient } from "@/lib/connections/agency-queries";
import { recordAiUsage } from "@/lib/features/ai-usage";
import { listInteractionsByClient } from "@/lib/interactions/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { listPlacementsByClient } from "@/lib/placements/queries";
import {
  listReferralStatusHistoriesByReferralIds,
  listReferralsByClient,
} from "@/lib/referrals/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * クライアント詳細画面用 AI 状況サマリー(ストリーミング)
 *
 * エージェントが既に画面で見られるデータのみを文脈にして、状況把握と次アクションを
 * 生成する。プロフィールは getDisclosableProfileForLinkedClient 経由でのみ取得し、
 * 戻り値は DisclosableProfile 型(wants + user_facts のみ、内面は型レベルで除外)。
 * career_profile を直接 SELECT しない(extractDisclosableProfile を通る単一経路)。
 *
 * 認可は二重〜三重防御:
 *   1. auth.getUser で未ログイン → 401
 *   2. getUserRole で organization_member 以外 → 403
 *   3. client_record.organizationId が自組織と一致しない → 404(他組織アクセス防止)
 *   4. プロフィール開示は linked または期限内 revoke_requested のときのみ。
 *      それ以外は RPC 側が forbidden になるため try/catch で握って null に倒す
 *      (対応履歴・紹介・タスクは自組織のデータなのでそのまま渡してよい)。
 *
 * ストリーミングは toTextStreamResponse() でプレーンテキストを返す。
 * クライアント側は fetch + ReadableStream で読み取る軽量パターンを想定し、
 * useChat のような会話履歴管理は不要(サマリーは単発生成)。
 */
export const maxDuration = 60;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  // 1) 認証
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) ロールチェック(organization_member 限定)
  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3) クライアントの組織一致チェック(他組織の id を踏んだら 404)
  const client = await getClientRecord(id);
  if (!client || client.organizationId !== role.organization.id) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const orgId = role.organization.id;

  // 4) データ収集(全て org スコープ・既存 lib 関数を再利用)
  //    画面と同じ関数を使い、画面に出ているデータと AI に渡すデータを揃える。
  const [referrals, interactions, placements, tasks] = await Promise.all([
    listReferralsByClient(client.id),
    listInteractionsByClient(client.id, orgId),
    listPlacementsByClient(client.id, orgId),
    listTasksByClient(client.id, orgId),
  ]);

  const historiesByReferral = await listReferralStatusHistoriesByReferralIds(
    referrals.map((r) => r.id),
    orgId,
  );

  // 開示プロフィールは linked または期限内 revoke_requested のときだけ取得を試みる。
  // それ以外の状態(unlinked/invited/revoked/期限切れ)では本人プロフィールは AI に
  // 渡さない。組織のデータ(対応履歴・紹介・タスク)は渡してよい。
  let disclosableProfile = null;
  if (
    client.linkedUserId &&
    (client.linkStatus === "linked" || client.linkStatus === "revoke_requested")
  ) {
    try {
      disclosableProfile = await getDisclosableProfileForLinkedClient(client.id);
    } catch (err) {
      // 認可失敗(期限超過の revoke_requested 等)は致命ではない。
      // プロフィール抜きでサマリーを生成して続行する。
      console.warn("Disclosable profile fetch failed (continuing without it):", err);
      disclosableProfile = null;
    }
  }

  // 5) AI 呼び出し
  try {
    const userPrompt = buildAgencyClientSummaryPrompt({
      client,
      referrals,
      historiesByReferral,
      interactions,
      placements,
      tasks,
      disclosableProfile,
    });

    const result = streamText({
      model: getModel(MODELS.CONVERSATION),
      system: AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT,
      prompt: userPrompt,
      onError: ({ error }) => {
        // ストリーム途中のエラーはサーバログに分類して残す。
        // クライアント側にはストリーム途切れとして見える。
        const info = categorizeAIError(error);
        console.error(
          "Agency client summary streaming error:",
          info.category,
          info.userMessage,
          error,
        );
      },
    });

    // 利用ログ(失敗 して も 本処理 は 止めない)。 ストリーム 開始 直後 に 計上。
    // ストリーム 中 で エラー が 出ても 「呼び出した = 1 回」 として 課金 軸 を 維持。
    await recordAiUsage(supabase, user.id, "agency_client_summary", { clientId: id });

    // プレーンテキストストリームを返す(useChat 不要・fetch + ReadableStream で読む)
    return result.toTextStreamResponse();
  } catch (err) {
    // ストリーム開始前の同期エラーは JSON で返す。
    // 内部スキーマや API キーの状態は漏らさず、汎用文言に倒す。
    const info = categorizeAIError(err);
    return NextResponse.json(
      {
        error: info.userMessage,
        category: info.category,
        retryable: info.retryable,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}
