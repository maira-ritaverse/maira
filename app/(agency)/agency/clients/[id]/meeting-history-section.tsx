/**
 * クライアント詳細の「面談履歴」セクション
 *
 * - meeting_schedules(このクライアント)を新しい順に表示
 * - 各行に状態バッジ + 録画の文字起こし表示 + アクション(参加/再スケジュール/キャンセル)
 * - 録画の文字起こしは career_intake_recordings.encrypted_extraction を復号して
 *   モーダルで表示(MeetingTranscriptDialog)
 *
 * サーバーコンポーネント。データ取得 + 復号は SSR で完結。
 */
import { Card } from "@/components/ui/card";
import { listMeetingsByClientRecord } from "@/lib/meetings/queries";
import type { MeetingScheduleView } from "@/lib/meetings/types";
import { createClient } from "@/lib/supabase/server";
import { decryptField } from "@/lib/crypto/field-encryption";

import { MeetingHistoryClient } from "./meeting-history-client";

type Props = {
  clientRecordId: string;
};

export type MeetingHistoryEntry = MeetingScheduleView & {
  /** 録画取込み完了の場合、復号した文字起こしテキスト(未取込なら null) */
  transcriptText: string | null;
};

export async function MeetingHistorySection({ clientRecordId }: Props) {
  const supabase = await createClient();
  const meetings = await listMeetingsByClientRecord(supabase, clientRecordId);

  if (meetings.length === 0) {
    return (
      <Card className="space-y-2 p-5">
        <h2 className="text-base font-semibold">面談履歴</h2>
        <p className="text-muted-foreground text-sm">
          まだ Web 面談の予約はありません。クライアント詳細上部の「面談を予約」から作成できます。
        </p>
      </Card>
    );
  }

  // 録画 ID の集合を作って、対応する文字起こしを並列復号する
  const recordingIds = meetings.map((m) => m.recordingId).filter((v): v is string => v !== null);
  const transcriptByRecording = new Map<string, string>();
  if (recordingIds.length > 0) {
    const { data: recs } = await supabase
      .from("career_intake_recordings")
      .select("id, encrypted_transcript")
      .in("id", recordingIds);
    if (recs) {
      for (const r of recs as Array<{ id: string; encrypted_transcript: string | null }>) {
        if (r.encrypted_transcript) {
          const decoded = await decryptField(r.encrypted_transcript);
          if (decoded) {
            transcriptByRecording.set(r.id, decoded);
          }
        }
      }
    }
  }

  const entries: MeetingHistoryEntry[] = meetings.map((m) => ({
    ...m,
    transcriptText: m.recordingId ? (transcriptByRecording.get(m.recordingId) ?? null) : null,
  }));

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">面談履歴</h2>
        <span className="text-muted-foreground text-xs">{entries.length} 件</span>
      </div>
      <MeetingHistoryClient entries={entries} />
    </Card>
  );
}
