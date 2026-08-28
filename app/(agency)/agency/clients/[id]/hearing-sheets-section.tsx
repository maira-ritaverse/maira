import { Card } from "@/components/ui/card";
import { listHearingSheets } from "@/lib/agency-client-documents/queries";
import {
  getHearingSheetTitle,
  listHearingSheetQuestions,
} from "@/lib/hearing-sheet-questions/queries";

import { HearingSheetsList } from "./hearing-sheets-list";

type Props = {
  organizationId: string;
  clientRecordId: string;
  isAdmin: boolean;
};

/**
 * meetings タブの「ヒアリングシート」セクション(Server Component)。
 *
 * 一覧 + 新規作成 + インライン編集まで一画面で完結する小さなフォーム。
 * 履歴書 / CV と違って遷移ページは作らない(面談中に開いて即記入する用途のため)。
 *
 * タイトル・質問項目は組織設定(hearing_sheet_question_definitions /
 * organization_hearing_sheet_settings)から取得して動的に描画する。
 */
export async function HearingSheetsSection({ organizationId, clientRecordId, isAdmin }: Props) {
  const [items, questions, title] = await Promise.all([
    listHearingSheets(clientRecordId, organizationId),
    listHearingSheetQuestions(organizationId),
    getHearingSheetTitle(organizationId),
  ]);
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-muted-foreground text-sm">
          面談中 / 後に入力するヒアリングシート。後続の AI 抽出と差分照合する用途にも使えます。
        </p>
      </div>
      <HearingSheetsList
        clientRecordId={clientRecordId}
        initialItems={items}
        questions={questions}
        isAdmin={isAdmin}
      />
    </div>
  );
}

export function HearingSheetsEmpty() {
  return (
    <Card className="text-muted-foreground p-6 text-sm">まだヒアリングシートはありません。</Card>
  );
}
