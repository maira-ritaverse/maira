import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { listPlacementsByOrganization } from "@/lib/placements/queries";
import { aggregatePlacements } from "@/lib/placements/aggregate";
import { listReferralsByOrganization } from "@/lib/referrals/queries";
import { getReferralStatusConfig } from "@/lib/referrals/types";
import { buildCsvFilename, csvFormat, toCsv } from "@/lib/csv/format";
import { csvResponse } from "@/lib/csv/response";

/**
 * GET /api/agency/export/placements
 *
 * 成約・売上(referral 単位で aggregatePlacements を適用)を CSV で返す。
 *
 * 「画面のレポート(成約・売上)と金額が一致する」ことを担保するため、
 * 集計関数は aggregatePlacements を流用する(レポートの土台と同じロジック)。
 *
 * 出力単位:placements を持つ referral 1 行 = 1 件。
 * 権限:admin OR export 権限を持つ advisor のみ。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canExport(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 並行で取得(referrals は client/job の付帯情報を持つ)
  const [placements, referrals] = await Promise.all([
    listPlacementsByOrganization(role.organization.id),
    listReferralsByOrganization(role.organization.id),
  ]);

  // referral_id → referral 情報の Map
  const referralMap = new Map(referrals.map((r) => [r.id, r]));

  // referral_id ごとに placements をまとめる(0 件 referral は除外する)
  const groupedByReferral = new Map<string, typeof placements>();
  for (const p of placements) {
    const list = groupedByReferral.get(p.referralId);
    if (list) list.push(p);
    else groupedByReferral.set(p.referralId, [p]);
  }

  const header = [
    "クライアント氏名",
    "クライアントメール",
    "求人企業名",
    "ポジション",
    "紹介ステータス",
    "純売上(円)",
    "入金済(円)",
    "残額(円)",
    "成約合計(円)",
    "追加報酬合計(円)",
    "返金合計(円)",
    "イベント件数",
    "最終イベント日",
  ];

  const rows: string[][] = [];
  for (const [referralId, items] of groupedByReferral.entries()) {
    const ref = referralMap.get(referralId);
    const agg = aggregatePlacements(items);

    // 最終イベント日:items は event_date 降順で取得しているので先頭を採用
    const latest = items[0]?.eventDate ?? "";

    rows.push([
      csvFormat.text(ref?.clientName ?? "(削除されたクライアント)"),
      csvFormat.text(ref?.clientEmail ?? ""),
      csvFormat.text(ref?.jobCompanyName ?? "(削除された求人)"),
      csvFormat.text(ref?.jobPosition ?? ""),
      ref ? getReferralStatusConfig(ref.status).label : "",
      csvFormat.number(agg.netRevenue),
      csvFormat.number(agg.paid),
      csvFormat.number(agg.unpaid),
      csvFormat.number(agg.placementTotal),
      csvFormat.number(agg.additionalTotal),
      csvFormat.number(agg.refundTotal),
      csvFormat.number(items.length),
      csvFormat.dateOnly(latest),
    ]);
  }

  // 表示順:最終イベント日の降順(空文字は末尾)
  rows.sort((a, b) => {
    const ad = a[a.length - 1];
    const bd = b[b.length - 1];
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return bd.localeCompare(ad);
  });

  return csvResponse(toCsv([header, ...rows]), buildCsvFilename("placements"));
}
