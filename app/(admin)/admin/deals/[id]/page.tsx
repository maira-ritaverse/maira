import { notFound } from "next/navigation";

import { getProspect, listMeetings } from "@/lib/sales/queries";

import { ProspectDetail } from "./prospect-detail";

/**
 * /admin/deals/[id]
 *
 * 商談の詳細。会社情報 + ステージ操作 + ミーティングのタイムライン(議事録 / AIアドバイス)。
 * /admin/* レイアウトで isMairaAdmin ガード済み。
 */
type RouteParams = { params: Promise<{ id: string }> };

export default async function AdminDealDetailPage({ params }: RouteParams) {
  const { id } = await params;
  const [prospect, meetings] = await Promise.all([getProspect(id), listMeetings(id)]);
  if (!prospect) notFound();

  return <ProspectDetail prospect={prospect} initialMeetings={meetings} />;
}
