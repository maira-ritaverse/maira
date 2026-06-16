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
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

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
