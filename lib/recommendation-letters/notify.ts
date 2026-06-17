/**
 * 推薦文(recommendation_letters)関連の通知発火ヘルパー
 *
 * 直接 fireSeekerNotification を呼ぶ箇所(API ルート)から、referral →
 * client_records / job_postings / organizations の解決を引き剥がすために
 * このモジュールに集約する。
 *
 * 通知の方針:
 *   ・推薦文の本文 / 件名は機微なので、通知ペイロードには載せない。
 *     遷移先(/app/recommendation-letters/[id])で復号して表示する。
 *   ・求職者(client_records.linked_user_id)が連携済の場合のみ通知。
 *     未連携クライアントは通知を受け取らない(届ける先がそもそも無い)。
 */
import { fireSeekerNotification } from "@/lib/notifications/in-app";
import { createServiceClient } from "@/lib/supabase/service";

type ReferralLookupRow = {
  client_record_id: string;
  job_posting_id: string;
  client_records: {
    linked_user_id: string | null;
    link_status: string | null;
  } | null;
  job_postings: {
    company_name: string;
    position: string;
  } | null;
};

/**
 * 推薦文が finalized になった通知を求職者本人に送る。
 * 通知失敗は throw せず console.error にとどめる(本フローの主トランザクションは
 * すでに完了しているので、通知が落ちても致命ではない)。
 */
export async function notifyRecommendationLetterFinalized(args: {
  letterId: string;
  referralId: string;
  organizationId: string;
}): Promise<void> {
  const service = createServiceClient();

  // referral → client_records / job_postings を一発で join
  const { data, error } = await service
    .from("referrals")
    .select(
      `
      client_record_id,
      job_posting_id,
      client_records ( linked_user_id, link_status ),
      job_postings ( company_name, position )
    `,
    )
    .eq("id", args.referralId)
    .maybeSingle();

  if (error || !data) {
    console.error("[recommendation-letters/notify] referral lookup failed", {
      referralId: args.referralId,
      message: error?.message,
    });
    return;
  }

  // PostgREST の組み込み join は配列 / オブジェクトどちらでも来うる。両対応。
  const row = data as unknown as ReferralLookupRow & {
    client_records: ReferralLookupRow["client_records"] | ReferralLookupRow["client_records"][];
    job_postings: ReferralLookupRow["job_postings"] | ReferralLookupRow["job_postings"][];
  };
  const clientRecord = Array.isArray(row.client_records)
    ? row.client_records[0]
    : row.client_records;
  const jobPosting = Array.isArray(row.job_postings) ? row.job_postings[0] : row.job_postings;

  if (!clientRecord || clientRecord.link_status !== "linked" || !clientRecord.linked_user_id) {
    // 未連携クライアント → 通知先が存在しない(無通知で正常終了)
    return;
  }

  // 組織名を取得(通知タイトル用)
  const { data: orgRow } = await service
    .from("organizations")
    .select("name")
    .eq("id", args.organizationId)
    .maybeSingle();
  const organizationName = (orgRow as { name: string } | null)?.name ?? "エージェント";

  const jobLabel = jobPosting ? `${jobPosting.company_name} / ${jobPosting.position}` : "求人";

  await fireSeekerNotification({
    userId: clientRecord.linked_user_id,
    payload: {
      kind: "recommendation_letter_finalized_for_seeker",
      title: `推薦文が届きました(${organizationName} / ${jobLabel})`,
      href: `/app/recommendation-letters/${args.letterId}`,
      recommendationLetterId: args.letterId,
      referralId: args.referralId,
      jobLabel,
      organizationName,
    },
  });
}
