import { Card } from "@/components/ui/card";
import { listHearingSheets } from "@/lib/agency-client-documents/queries";

import { HearingSheetsList } from "./hearing-sheets-list";

type Props = {
  organizationId: string;
  clientRecordId: string;
};

/**
 * meetings タブの「ヒアリングシート」セクション(Server Component)。
 *
 * 一覧 + 新規作成 + インライン編集まで一画面で完結する小さなフォーム。
 * 履歴書 / CV と違って遷移ページは作らない(面談中に開いて即記入する用途のため)。
 */
export async function HearingSheetsSection({ organizationId, clientRecordId }: Props) {
  const items = await listHearingSheets(clientRecordId, organizationId);
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        面談中 / 後に入力するヒアリングシート。後続の AI 抽出と差分照合する用途にも使えます。
      </p>
      <HearingSheetsList clientRecordId={clientRecordId} initialItems={items} />
    </div>
  );
}

export function HearingSheetsEmpty() {
  return (
    <Card className="text-muted-foreground p-6 text-sm">まだヒアリングシートはありません。</Card>
  );
}
