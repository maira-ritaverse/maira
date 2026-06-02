/**
 * 成約(placements)のクエリヘルパー
 *
 * RLS により、呼び出し元ユーザーが所属する企業の成約のみ返る。
 * 構造は interactions/queries.ts と揃えている。
 *
 * 一覧では「誰が記録したか」を表示するため、
 * list_organization_member_display_names(SECURITY DEFINER)で
 * メンバー表示名 Map を合流する。
 *
 * 1 referral に複数 placements 行(成約 + 入金 + 返金 + 追加報酬)を持つ前提なので、
 * クライアント単位で取って UI 側で referralId ごとに groupBy する想定。
 */

import { createClient } from "@/lib/supabase/server";
import type { Placement, PlacementEventType, PaymentStatus, PlacementWithAuthor } from "./types";

type PlacementRow = {
  id: string;
  organization_id: string;
  referral_id: string;
  event_type: string;
  amount: number | null;
  expected_salary: number | null;
  // numeric は文字列で来うる
  commission_rate: number | string | null;
  event_date: string;
  payment_status: string | null;
  notes: string | null;
  reason: string | null;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

function rowToPlacement(row: PlacementRow): Placement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    referralId: row.referral_id,
    eventType: row.event_type as PlacementEventType,
    amount: row.amount,
    expectedSalary: row.expected_salary,
    commissionRate:
      row.commission_rate === null
        ? null
        : typeof row.commission_rate === "string"
          ? Number(row.commission_rate)
          : row.commission_rate,
    eventDate: row.event_date,
    paymentStatus: row.payment_status as PaymentStatus | null,
    notes: row.notes,
    reason: row.reason,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * あるクライアントに紐づく referrals の成約一覧(全イベント、記録者名つき)
 *
 * 並び順は event_date 降順 → created_at 降順(同日内は新しい入力が上)。
 *
 * referral_id → client_record_id の関連は別クエリで取って絞り込む。
 * (placements 単体に client_record_id は持たせていないので、
 *  referral 経由で in 句で絞る)
 */
export async function listPlacementsByClient(
  clientRecordId: string,
  organizationId: string,
): Promise<PlacementWithAuthor[]> {
  const supabase = await createClient();

  // 1) このクライアントの referral_id 一覧を取る
  const { data: refRows, error: refError } = await supabase
    .from("referrals")
    .select("id")
    .eq("client_record_id", clientRecordId);

  if (refError || !refRows || refRows.length === 0) return [];

  const referralIds = (refRows as { id: string }[]).map((r) => r.id);

  // 2) placements を referral_id IN (...) で取る
  const { data, error } = await supabase
    .from("placements")
    .select("*")
    .in("referral_id", referralIds)
    .order("event_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const placements = (data as PlacementRow[]).map(rowToPlacement);

  // 3) 記録者の表示名 Map を取得(RLS バイパス関数経由、失敗しても null で続行)
  const { data: memberRows, error: memberError } = await supabase.rpc(
    "list_organization_member_display_names",
    { target_organization_id: organizationId },
  );

  const nameByMemberId = new Map<string, string | null>();
  if (!memberError && memberRows) {
    for (const row of memberRows as Array<{ member_id: string; display_name: string | null }>) {
      nameByMemberId.set(row.member_id, row.display_name);
    }
  }

  return placements.map((p) => ({
    ...p,
    authorName: p.createdByMemberId ? (nameByMemberId.get(p.createdByMemberId) ?? null) : null,
  }));
}

/**
 * 組織全体の placements を取得(エクスポート用)
 *
 * RLS で自社のみだが二重防御で organization_id eq。
 * 並び順は event_date 降順 → created_at 降順。
 * 集計(aggregatePlacements)で referral 単位の純売上を出すために、生イベントを全件返す。
 */
export async function listPlacementsByOrganization(organizationId: string): Promise<Placement[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("placements")
    .select("*")
    .eq("organization_id", organizationId)
    .order("event_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as PlacementRow[]).map(rowToPlacement);
}
