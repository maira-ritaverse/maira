/**
 * クライアント詳細の「AI ヒアリング録音アップロード」セクション
 *
 * - エージェントが対象クライアントを指定して音声をアップロード
 * - アップロード済みの履歴を一覧表示(状態 / 文字起こしリンク)
 * - 完了後は求職者本人にレビュー依頼が自動送信される(別フローで実装)
 *
 * サーバーコンポーネント:対象クライアントの過去アップロード一覧を取得して
 * クライアントコンポーネントに渡す。
 */
import { Lock } from "lucide-react";

import { Card } from "@/components/ui/card";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { IntakeUploadClient } from "./intake-upload-client";

type Props = {
  clientRecordId: string;
  clientLinked: boolean;
  clientName: string;
};

export type AgencyIntakeRow = {
  id: string;
  originalFilename: string;
  status: string;
  statusMessage: string | null;
  createdAt: string;
  hasTranscript: boolean;
  hasExtraction: boolean;
};

export async function IntakeUploadSection({ clientRecordId, clientLinked, clientName }: Props) {
  const supabase = await createClient();

  // 組織 の 録音 アップロード フラグ を 確認 (default false)。
  // getUserRole で org id を 引く の は 少し 冗長 だが、 client_records の
  // organization_id を 直接 引いて も 良い (今 回 は 既存 helper 流用)。
  const user = await getCurrentUser();
  const role = user ? await getUserRole(user.id) : null;
  const orgId = role?.organization?.id ?? null;
  let recordingUploadEnabled = false;
  if (orgId) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("recording_upload_enabled")
      .eq("id", orgId)
      .maybeSingle();
    recordingUploadEnabled = Boolean(orgRow?.recording_upload_enabled);
  }

  if (!recordingUploadEnabled) {
    return (
      <Card className="space-y-2 p-5">
        <div className="flex items-center gap-2">
          <Lock className="text-muted-foreground h-4 w-4" aria-hidden />
          <h2 className="text-base font-semibold">AI ヒアリング</h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
            開発中
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          録音アップロードによる AI ヒアリング機能は現在開発中です。近日提供予定。
        </p>
      </Card>
    );
  }

  const { data } = await supabase
    .from("career_intake_recordings")
    .select(
      "id, original_filename, status, status_message, created_at, encrypted_transcript, encrypted_extraction",
    )
    .eq("client_record_id", clientRecordId)
    .eq("transcript_purpose", "agency_interview")
    .order("created_at", { ascending: false });

  const rows: AgencyIntakeRow[] = (data ?? []).map((r) => {
    const row = r as {
      id: string;
      original_filename: string;
      status: string;
      status_message: string | null;
      created_at: string;
      encrypted_transcript: string | null;
      encrypted_extraction: string | null;
    };
    return {
      id: row.id,
      originalFilename: row.original_filename,
      status: row.status,
      statusMessage: row.status_message,
      createdAt: row.created_at,
      hasTranscript: !!row.encrypted_transcript,
      hasExtraction: !!row.encrypted_extraction,
    };
  });

  if (!clientLinked) {
    return (
      <Card className="space-y-2 p-5">
        <h2 className="text-base font-semibold">AI ヒアリング</h2>
        <p className="text-muted-foreground text-sm">
          {clientName} さんは Maira アカウントを連携していません。
          先に招待してから、ヒアリング録音をアップロードしてください。
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">AI ヒアリング</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            キャリア面談の録音をアップロードすると、AI が文字起こし → 構造化抽出 →{clientName}{" "}
            さんに「キャリア棚卸しに反映してよいか?」と確認依頼が送られます。
          </p>
        </div>
      </div>

      <IntakeUploadClient clientRecordId={clientRecordId} rows={rows} />
    </Card>
  );
}
