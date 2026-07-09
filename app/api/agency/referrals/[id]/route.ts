import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fireInAppNotification, fireSeekerNotification } from "@/lib/notifications/in-app";
import { getUserRole } from "@/lib/organizations/queries";
import { getReferralStatusConfig, updateReferralRequestSchema } from "@/lib/referrals/types";
import type { ReferralStatus } from "@/lib/referrals/types";
import { getOrganizationSlackWebhookUrl, sendSlackMessage } from "@/lib/slack/notify";

/**
 * PATCH /api/agency/referrals/[id]
 *
 * 紹介を部分更新する(主にステータス変更・メモ更新)。
 * - 認証 + organization_member ガード(履歴記録のため role.member も必須)
 * - RLS により自社の紹介のみ更新可能。念のため organization_id でも絞る
 *   (RLS が外れた場合の二重防御)。
 * - client_record_id / job_posting_id は不変扱いなので更新対象に含めない。
 * - status が実際に変わった場合のみ referral_status_history に履歴を自動記録する。
 *   DB トリガーではなくアプリ層で記録する理由は、変更者(changed_by_member_id)を
 *   ここで持っている auth コンテキストから直接取れるため。
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  // 履歴記録で role.member.id が必要なため、member 不在時もここで弾く
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateReferralRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // undefined の フィールド は 更新 対象 に 含め ない (部分 更新)
  const updateData: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.status !== undefined) updateData.status = d.status;
  if (d.notes !== undefined) updateData.notes = d.notes || null;
  if (d.scheduled_interview_at !== undefined) {
    // 空文字 / null は 「予定 取り消し」 と 扱う
    updateData.scheduled_interview_at = d.scheduled_interview_at ?? null;
  }
  if (d.interview_note !== undefined) {
    updateData.interview_note = d.interview_note || null;
  }
  if (d.offer_deadline_at !== undefined) {
    updateData.offer_deadline_at = d.offer_deadline_at ?? null;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  const orgId = role.organization.id;

  // 履歴記録のために更新前 status を取得する。
  // ついでに organization_id をここで読み直し、履歴の organization_id にもこれを使う
  // (current_user_organization_id() と一致するが、二重防御の意味で referral 側を採用)。
  // 通知発火に必要な client_record_id も同時に取得する(別 select を増やさない)。
  // status を更新しない場合(notes だけの更新)はそもそも履歴記録不要なので select もスキップ。
  let previousStatus: string | null = null;
  let referralClientRecordId: string | null = null;
  if (d.status !== undefined) {
    const { data: current, error: fetchError } = await supabase
      .from("referrals")
      .select("status, organization_id, client_record_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: "Failed to load referral", message: fetchError.message },
        { status: 500 },
      );
    }
    if (!current) {
      return NextResponse.json({ error: "Referral not found" }, { status: 404 });
    }
    previousStatus = current.status as string;
    referralClientRecordId = current.client_record_id as string;
  }

  const { error } = await supabase
    .from("referrals")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }

  // 更新成功後、status が実際に変わった場合だけ履歴を残す。
  //   - 同じ値の上書き(planned → planned)では何もしない(重複記録の防止)
  //   - 履歴 insert が失敗しても referrals.update 自体は成功している。
  //     ここでロールバックする手段は無いので、ログだけ残してリクエストは成功扱い。
  //     真にアトミックにしたい場合は RPC ファンクションに昇格させる前提。
  if (d.status !== undefined && d.status !== previousStatus) {
    const { error: historyError } = await supabase.from("referral_status_history").insert({
      organization_id: orgId,
      referral_id: id,
      from_status: previousStatus,
      to_status: d.status,
      changed_by_member_id: role.member.id,
      // changed_at は DB デフォルト(now())に任せる
    });

    if (historyError) {
      console.error("[referral-history] Failed to record status transition", {
        referralId: id,
        from: previousStatus,
        to: d.status,
        message: historyError.message,
      });
    }

    // 通知発火(同組織の別メンバー向け、本人は除外)。
    // referral 更新本体は既に成功している。通知の失敗は呼び出し側に影響させない
    // (try/catch で全体を握りつぶす)。理由:
    //   - 通知は副次的なシグナル。referrals.update が成功したのに 5xx を返すと
    //     クライアントが「失敗」と誤判定して二重操作の原因になる。
    //   - service_role を使うので RLS ではなくアプリ層で受信者を絞り込む責任がある。
    //     ここでは organization_id でメンバー全員を引き、本人を後段で除外。
    if (referralClientRecordId) {
      try {
        // クライアント名と変更者の display_name を取得(求職者の内面情報は触らない)
        const [{ data: clientRow }, { data: actorProfile }] = await Promise.all([
          supabase
            .from("client_records")
            .select("id, name")
            .eq("id", referralClientRecordId)
            .maybeSingle(),
          supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
        ]);

        if (clientRow) {
          const fromLabel = previousStatus
            ? getReferralStatusConfig(previousStatus as ReferralStatus).label
            : null;
          const toLabel = getReferralStatusConfig(d.status).label;
          const title = fromLabel
            ? `${fromLabel} → ${toLabel}: ${clientRow.name}さん`
            : `${toLabel}: ${clientRow.name}さん`;

          await fireInAppNotification({
            organizationId: orgId,
            excludeUserId: user.id,
            payload: {
              kind: "referral_status_change",
              title,
              href: `/agency/clients/${clientRow.id}`,
              referralId: id,
              clientRecordId: clientRow.id,
              clientName: clientRow.name,
              fromStatus: previousStatus,
              toStatus: d.status,
              actorDisplayName: actorProfile?.display_name ?? null,
            },
          });

          // 求職者本人にも通知(linked クライアントのみ)。
          // 求人名 + ステータス遷移のみ載せ、エージェント内部メモ(notes)等は含めない。
          const { data: linkedRow } = await supabase
            .from("client_records")
            .select("linked_user_id")
            .eq("id", clientRow.id)
            .maybeSingle();
          const linkedUserId = (linkedRow as { linked_user_id: string | null } | null)
            ?.linked_user_id;
          if (linkedUserId) {
            // 求人名を取得(referrals → job_postings)
            const { data: refRow } = await supabase
              .from("referrals")
              .select("job_posting_id, job_postings(company_name, position)")
              .eq("id", id)
              .maybeSingle();
            const job =
              (refRow as {
                job_posting_id: string;
                job_postings:
                  | { company_name: string; position: string }
                  | { company_name: string; position: string }[]
                  | null;
              } | null) ?? null;
            const j = job?.job_postings
              ? Array.isArray(job.job_postings)
                ? job.job_postings[0]
                : job.job_postings
              : null;
            const jobLabel = j ? `${j.company_name} ・ ${j.position}` : "求人";
            const seekerTitle = fromLabel
              ? `${fromLabel} → ${toLabel}: ${jobLabel}`
              : `${toLabel}: ${jobLabel}`;
            await fireSeekerNotification({
              userId: linkedUserId,
              payload: {
                kind: "referral_status_change_for_seeker",
                title: seekerTitle,
                href: "/app/agent-referrals",
                referralId: id,
                jobLabel,
                fromStatus: previousStatus,
                toStatus: d.status,
              },
            });
          }

          // Slack 連携:重要な遷移(offer / joined / declined)を組織の Slack に流す。
          // Webhook URL が未設定なら no-op で skip(notify 内で判定)。
          // 通知失敗は本処理に影響させない(in-app と同じ方針)。
          if (d.status === "offer" || d.status === "joined" || d.status === "declined") {
            const slackUrl = await getOrganizationSlackWebhookUrl(orgId);
            if (slackUrl) {
              const fromLabelForSlack = previousStatus
                ? getReferralStatusConfig(previousStatus as ReferralStatus).label
                : "—";
              const toLabelForSlack = getReferralStatusConfig(d.status).label;
              const emojiMap: Record<string, string> = {
                offer: ":tada:",
                joined: ":confetti_ball:",
                declined: ":disappointed:",
              };
              const emoji = emojiMap[d.status] ?? "";
              const actorName = actorProfile?.display_name ?? "(担当者)";
              const slackText = `${emoji} *${clientRow.name}* さんの応募ステータスが *${fromLabelForSlack} → ${toLabelForSlack}* になりました(${actorName})`;
              const result = await sendSlackMessage({ webhookUrl: slackUrl, text: slackText });
              if (!result.sent && result.reason === "failed") {
                console.warn("[slack] notification failed:", result.error);
              }
            }
          }
        }
      } catch (notifyErr) {
        console.error("[notifications] firing failed (referral update succeeded)", {
          referralId: id,
          message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
      }
    }
  }

  return NextResponse.json({ success: true });
}
