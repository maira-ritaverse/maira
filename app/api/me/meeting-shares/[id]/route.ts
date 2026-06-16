/**
 * PATCH /api/me/meeting-shares/[id]
 *
 * 求職者本人が、エージェント面談で抽出された職務経歴ドラフトを「承認」or「拒否」する。
 *
 * Body:
 *   { action: "accept" | "reject" }
 *
 * 承認時(action=accept):
 *   ・status='accepted' + responded_at をスタンプ
 *   ・(Phase 5.x の追加実装で)career_profile にマージするバックグラウンド処理を発火
 *
 * 拒否時(action=reject):
 *   ・status='rejected' + responded_at をスタンプ
 *
 * 認可:
 *   ・RLS により seeker_user_id = auth.uid() の行しか UPDATE できない
 *   ・status が既に accepted/rejected/expired の行は変更不可(ガード)
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { getCareerProfile, saveCareerProfile } from "@/lib/career/conversations";
import {
  buildSkeletonFromExtraction,
  mergeExtractionIntoProfile,
} from "@/lib/career/merge-from-extraction";
import { extractionResultSchema } from "@/lib/career-intake/types";
import { decryptField } from "@/lib/crypto/field-encryption";

const requestSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;
  const { id } = await context.params;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = requestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 現状の status を取得して未応答(pending)を確認
  const { data: share } = await supabase
    .from("meeting_interview_shares")
    .select("id, status, seeker_user_id, expires_at, recording_id")
    .eq("id", id)
    .maybeSingle();
  if (!share) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = share as {
    id: string;
    status: "pending" | "accepted" | "rejected" | "expired";
    seeker_user_id: string;
    expires_at: string;
    recording_id: string;
  };
  if (row.seeker_user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: "already_responded", status: row.status }, { status: 409 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  const nextStatus = parsed.data.action === "accept" ? "accepted" : "rejected";
  const { error } = await supabase
    .from("meeting_interview_shares")
    .update({
      status: nextStatus,
      responded_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: "db_update_failed", message: error.message },
      { status: 500 },
    );
  }

  // 承認時の career_profile 自動マージ
  // - 抽出 JSON を復号 → mergeExtractionIntoProfile(本人記述を上書きしない)
  // - 既存 career_profile が無ければ buildSkeletonFromExtraction で初期化
  // - applied_to_career_profile_at をスタンプ
  let mergeApplied = false;
  let changedFields: string[] = [];
  if (parsed.data.action === "accept") {
    try {
      const { data: recRow } = await supabase
        .from("career_intake_recordings")
        .select("encrypted_extraction")
        .eq("id", row.recording_id)
        .maybeSingle();
      const enc = (recRow as { encrypted_extraction: string | null } | null)?.encrypted_extraction;
      if (enc) {
        const json = await decryptField(enc);
        if (json) {
          const parsedExt = extractionResultSchema.safeParse(JSON.parse(json));
          if (parsedExt.success) {
            const existing = await getCareerProfile(user.id);
            if (existing) {
              const result = mergeExtractionIntoProfile(existing.profile, parsedExt.data);
              await saveCareerProfile(user.id, result.profile);
              changedFields = result.preview.changedFields;
            } else {
              await saveCareerProfile(user.id, buildSkeletonFromExtraction(parsedExt.data));
              changedFields = ["新規作成"];
            }
            mergeApplied = true;
            await supabase
              .from("meeting_interview_shares")
              .update({ applied_to_career_profile_at: new Date().toISOString() })
              .eq("id", id);
          }
        }
      }
    } catch (err) {
      // マージ失敗してもステータス変更は維持(後で再試行可能)
      console.error("[meeting-shares/accept] merge failed", err);
    }
  }

  return NextResponse.json({
    success: true,
    status: nextStatus,
    mergeApplied,
    changedFields,
  });
}
