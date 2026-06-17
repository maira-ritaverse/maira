import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/me/recommendation-letters/[id]
 *
 * 求職者本人向け:1 件の finalized 推薦文を本文ごと返す。
 *
 * 認可フロー(必ず 4 段重ねで検証する):
 *   1. requireUser(セッション + archived チェック)
 *   2. recommendation_letters.id を service_role で取得し
 *      status='finalized' を確認
 *   3. その referral の client_record の linked_user_id が auth.uid() と一致
 *      かつ link_status='linked'
 *   4. 一致しなければ 404(他人の推薦文 / 未連携を覗かれないよう存在自体を隠す)
 *
 * 本ルートは service_role を使うため、RLS のフォールバック保護に依存しない
 * 「自前ガード」を二重で書いている。
 */
type RouteParams = { params: Promise<{ id: string }> };

type ClientRecordRef = {
  linked_user_id: string | null;
  link_status: string | null;
};

type ReferralRef = {
  id: string;
  client_record_id: string;
  job_posting_id: string;
  client_records: ClientRecordRef | ClientRecordRef[] | null;
  job_postings:
    | { company_name: string; position: string }
    | { company_name: string; position: string }[]
    | null;
};

type LetterRow = {
  id: string;
  referral_id: string;
  organization_id: string;
  status: string;
  version: number;
  encrypted_headline: string;
  encrypted_body: string;
  finalized_at: string | null;
  created_at: string;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const service = createServiceClient();

  // 1. 推薦文を取得(status=finalized のみ)
  const { data: letterData, error: letterErr } = await service
    .from("recommendation_letters")
    .select(
      "id, referral_id, organization_id, status, version, encrypted_headline, encrypted_body, finalized_at, created_at",
    )
    .eq("id", id)
    .eq("status", "finalized")
    .maybeSingle();
  if (letterErr) {
    return NextResponse.json(
      { error: "lookup_failed", message: letterErr.message },
      { status: 500 },
    );
  }
  if (!letterData) {
    // finalized 推薦文が無い、または draft → 404 で存在自体を隠す
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const letter = letterData as LetterRow;

  // 2. referral → client_record の linked_user_id 検証
  const { data: referralData } = await service
    .from("referrals")
    .select(
      `
      id,
      client_record_id,
      job_posting_id,
      client_records ( linked_user_id, link_status ),
      job_postings ( company_name, position )
    `,
    )
    .eq("id", letter.referral_id)
    .maybeSingle();
  if (!referralData) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const referral = referralData as unknown as ReferralRef;
  const clientRecord = Array.isArray(referral.client_records)
    ? referral.client_records[0]
    : referral.client_records;
  if (
    !clientRecord ||
    clientRecord.link_status !== "linked" ||
    clientRecord.linked_user_id !== user.id
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 3. 組織名
  const { data: orgRow } = await service
    .from("organizations")
    .select("name")
    .eq("id", letter.organization_id)
    .maybeSingle();
  const organizationName = (orgRow as { name: string } | null)?.name ?? "エージェント";

  // 4. 復号 + 求人ラベル組み立て
  const [headline, body] = await Promise.all([
    decryptField(letter.encrypted_headline),
    decryptField(letter.encrypted_body),
  ]);
  const jp = referral.job_postings;
  const jobPosting = Array.isArray(jp) ? jp[0] : jp;
  const jobLabel = jobPosting ? `${jobPosting.company_name} / ${jobPosting.position}` : "求人";

  return NextResponse.json({
    letter: {
      id: letter.id,
      referralId: letter.referral_id,
      organizationId: letter.organization_id,
      organizationName,
      jobLabel,
      version: letter.version,
      headline: headline ?? "",
      body: body ?? "",
      finalizedAt: letter.finalized_at,
      createdAt: letter.created_at,
    },
  });
}
