import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/me/recommendation-letters
 *
 * 求職者本人向け:自分について書かれた finalized 推薦文の一覧を返す。
 *
 * 経路:
 *   auth.uid()
 *   → client_records.linked_user_id = auth.uid() (link_status='linked')
 *   → referrals.client_record_id = client_records.id
 *   → recommendation_letters.referral_id = referrals.id (status='finalized')
 *
 * 認可:
 *   ・requireUser ガード(archived チェック込み)
 *   ・recommendation_letters 自体は新規 RLS ポリシーで seeker 本人にも SELECT 許可
 *   ・referrals / client_records / organizations / job_postings は seeker 直接 SELECT
 *     できないため、service_role で linked_user_id = auth.uid() を明示条件にして取得する
 *
 * レスポンス:
 *   ・本文(body)は載せず、headline と前後の文脈(求人 / 組織)だけ返す
 *     (詳細ページで個別に GET して復号する)
 */
type ClientLink = { id: string };

type ReferralRow = {
  id: string;
  client_record_id: string;
  job_posting_id: string;
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
  encrypted_headline: string;
  finalized_at: string | null;
  created_at: string;
};

type OrgRow = { id: string; name: string };

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const service = createServiceClient();

  // 1. 連携済 client_records を取得(自分にぶら下がる行)
  const { data: clientRows, error: clientErr } = await service
    .from("client_records")
    .select("id")
    .eq("linked_user_id", user.id)
    .eq("link_status", "linked");
  if (clientErr) {
    return NextResponse.json(
      { error: "client_lookup_failed", message: clientErr.message },
      { status: 500 },
    );
  }
  const clientIds = (clientRows as ClientLink[] | null)?.map((r) => r.id) ?? [];
  if (clientIds.length === 0) {
    return NextResponse.json({ letters: [] });
  }

  // 2. それらを client_record_id にもつ referrals を取得(求人情報も join)
  const { data: referralRows, error: referralErr } = await service
    .from("referrals")
    .select("id, client_record_id, job_posting_id, job_postings ( company_name, position )")
    .in("client_record_id", clientIds);
  if (referralErr) {
    return NextResponse.json(
      { error: "referral_lookup_failed", message: referralErr.message },
      { status: 500 },
    );
  }
  const referrals = (referralRows as ReferralRow[] | null) ?? [];
  if (referrals.length === 0) {
    return NextResponse.json({ letters: [] });
  }
  const referralIds = referrals.map((r) => r.id);

  // 3. finalized 推薦文を取得(新しい順)
  const { data: letterRows, error: letterErr } = await service
    .from("recommendation_letters")
    .select(
      "id, referral_id, organization_id, status, encrypted_headline, finalized_at, created_at",
    )
    .in("referral_id", referralIds)
    .eq("status", "finalized")
    .order("finalized_at", { ascending: false });
  if (letterErr) {
    return NextResponse.json(
      { error: "letter_lookup_failed", message: letterErr.message },
      { status: 500 },
    );
  }
  const letters = (letterRows as LetterRow[] | null) ?? [];
  if (letters.length === 0) {
    return NextResponse.json({ letters: [] });
  }

  // 4. 組織名を一括取得(通知タイトルに使うのと同じ理由でラベルを返す)
  const orgIds = Array.from(new Set(letters.map((l) => l.organization_id)));
  const { data: orgRows } = await service.from("organizations").select("id, name").in("id", orgIds);
  const orgNameById = new Map<string, string>(
    ((orgRows as OrgRow[] | null) ?? []).map((o) => [o.id, o.name]),
  );

  // 5. referral lookup map(求人ラベル用)
  const referralById = new Map<string, ReferralRow>(referrals.map((r) => [r.id, r]));

  // 6. headline をまとめて復号
  const decryptedHeadlines = await Promise.all(
    letters.map((l) => decryptField(l.encrypted_headline)),
  );

  const out = letters.map((l, idx) => {
    const referral = referralById.get(l.referral_id);
    const jp = referral?.job_postings;
    const jobPosting = Array.isArray(jp) ? jp[0] : jp;
    const jobLabel = jobPosting ? `${jobPosting.company_name} / ${jobPosting.position}` : "求人";
    return {
      id: l.id,
      referralId: l.referral_id,
      organizationId: l.organization_id,
      organizationName: orgNameById.get(l.organization_id) ?? "エージェント",
      jobLabel,
      headline: decryptedHeadlines[idx] ?? "",
      finalizedAt: l.finalized_at,
      createdAt: l.created_at,
    };
  });

  return NextResponse.json({ letters: out });
}
