/**
 * interviews (面接 ラウンド) の クエリ ヘルパー。
 *
 * RLS で 自 組織 の レコード のみ 返る。 referral 経由 で 求人情報 (company_name /
 * position) を join し、 顧客 詳細 画面 の 応募 セクション で 面接 一覧 を 表示 する。
 */
import { createClient } from "@/lib/supabase/server";

import type { Interview, InterviewKind, InterviewResult } from "./types";

type InterviewRow = {
  id: string;
  organization_id: string;
  referral_id: string;
  kind: string;
  scheduled_at: string;
  result: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function rowToInterview(row: InterviewRow): Interview {
  return {
    id: row.id,
    organizationId: row.organization_id,
    referralId: row.referral_id,
    kind: row.kind as InterviewKind,
    scheduledAt: row.scheduled_at,
    result: row.result as InterviewResult,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * ある referral の 全 面接 ラウンド (scheduled_at 昇順)。
 * 応募 セクション で 「1 次 → 2 次 → 最終」 と 時系列 表示 する 用途。
 */
export async function listInterviewsByReferral(referralId: string): Promise<Interview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("referral_id", referralId)
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(`listInterviewsByReferral failed: ${error.message}`);
  return ((data ?? []) as InterviewRow[]).map(rowToInterview);
}

/**
 * ある クライアント の 全 面接 (すべて の referral を 横断)。
 * カレンダー 画面 で は queries.ts が 直接 SELECT する ため こちら は 未使用 だ が、
 * 将来 の 「顧客 詳細 の タイム ライン」 表示 で 使う 可能性 が ある。
 */
export async function listInterviewsByClient(clientRecordId: string): Promise<Interview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interviews")
    .select("*, referrals!inner ( client_record_id )")
    .eq("referrals.client_record_id", clientRecordId)
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(`listInterviewsByClient failed: ${error.message}`);
  return ((data ?? []) as InterviewRow[]).map(rowToInterview);
}
