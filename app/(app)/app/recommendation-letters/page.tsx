import Link from "next/link";

import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/api/auth-guards";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * /app/recommendation-letters
 *
 * 求職者本人向け:自分について書かれた finalized 推薦文の一覧。
 *
 * Server Component で直接 DB を引いて SSR する(/api/me/recommendation-letters
 * と重複するが、SSR で初期描画を速くするためのトレードオフとして許容)。
 * クエリロジックは API ルートと整合させること。
 */
type ReferralRow = {
  id: string;
  job_postings:
    | { company_name: string; position: string }
    | { company_name: string; position: string }[]
    | null;
};

type LetterRow = {
  id: string;
  referral_id: string;
  organization_id: string;
  encrypted_headline: string;
  finalized_at: string | null;
};

type OrgRow = { id: string; name: string };

async function loadLetters(userId: string) {
  const service = createServiceClient();

  const { data: clientRows } = await service
    .from("client_records")
    .select("id")
    .eq("linked_user_id", userId)
    .eq("link_status", "linked");
  const clientIds = ((clientRows as { id: string }[] | null) ?? []).map((r) => r.id);
  if (clientIds.length === 0) return [];

  const { data: referralRows } = await service
    .from("referrals")
    .select("id, job_postings ( company_name, position )")
    .in("client_record_id", clientIds);
  const referrals = (referralRows as ReferralRow[] | null) ?? [];
  if (referrals.length === 0) return [];
  const referralIds = referrals.map((r) => r.id);

  const { data: letterRows } = await service
    .from("recommendation_letters")
    .select("id, referral_id, organization_id, encrypted_headline, finalized_at")
    .in("referral_id", referralIds)
    .eq("status", "finalized")
    .order("finalized_at", { ascending: false });
  const letters = (letterRows as LetterRow[] | null) ?? [];
  if (letters.length === 0) return [];

  const orgIds = Array.from(new Set(letters.map((l) => l.organization_id)));
  const { data: orgRows } = await service.from("organizations").select("id, name").in("id", orgIds);
  const orgNameById = new Map<string, string>(
    ((orgRows as OrgRow[] | null) ?? []).map((o) => [o.id, o.name]),
  );

  const referralById = new Map<string, ReferralRow>(referrals.map((r) => [r.id, r]));
  const decryptedHeadlines = await Promise.all(
    letters.map((l) => decryptField(l.encrypted_headline)),
  );

  return letters.map((l, idx) => {
    const r = referralById.get(l.referral_id);
    const jp = r?.job_postings;
    const jobPosting = Array.isArray(jp) ? jp[0] : jp;
    return {
      id: l.id,
      headline: decryptedHeadlines[idx] ?? "",
      organizationName: orgNameById.get(l.organization_id) ?? "エージェント",
      jobLabel: jobPosting ? `${jobPosting.company_name} / ${jobPosting.position}` : "求人",
      finalizedAt: l.finalized_at,
    };
  });
}

export default async function SeekerRecommendationLettersPage() {
  const guard = await requireUser();
  if (!guard.ok) {
    // requireUser はレイアウト側で先に弾いている前提なので通常ここには来ない
    return null;
  }
  const letters = await loadLetters(guard.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">推薦文</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          エージェントが求人企業に向けてあなたを推薦するために書いた文章です。確定したもののみ表示されます。
        </p>
      </div>

      {letters.length === 0 ? (
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">まだ確定した推薦文はありません。</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {letters.map((l) => (
            <Link key={l.id} href={`/app/recommendation-letters/${l.id}`} className="block">
              <Card className="hover:bg-accent/40 p-4 transition-colors">
                <div className="text-muted-foreground mb-1 text-xs">
                  {l.organizationName} ・ {l.jobLabel}
                  {l.finalizedAt && (
                    <> ・ {new Date(l.finalizedAt).toLocaleDateString("ja-JP")} 受領</>
                  )}
                </div>
                <div className="text-foreground line-clamp-2 text-sm font-medium">
                  {l.headline || "(タイトルなし)"}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
