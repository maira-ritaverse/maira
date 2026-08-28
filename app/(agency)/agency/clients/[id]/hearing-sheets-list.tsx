"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import {
  hearingSheetContentSchema,
  type HearingSheet,
  type HearingSheetContent,
} from "@/lib/agency-client-documents/types";
import type { HearingQuestionDefinition } from "@/lib/hearing-sheet-questions/types";
import { useToast } from "@/lib/admin/toast/store";

type Props = {
  clientRecordId: string;
  initialItems: HearingSheet[];
  /** 組織のヒアリング質問定義(表示順・ラベル・入力欄種別)。 */
  questions: HearingQuestionDefinition[];
  /** 削除は管理者のみ(DELETE ルートが admin 限定のため、advisor には出さない)。 */
  isAdmin: boolean;
};

/**
 * ヒアリングシート一覧 + インライン編集。
 * 面談中の素早い入力を最優先に、設問単位の textarea を縦に並べる。
 * 質問項目は組織設定(hearing_sheet_question_definitions)から動的に描画する。
 */
export function HearingSheetsList({ clientRecordId, initialItems, questions, isAdmin }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<HearingSheet[]>(initialItems);
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();

  const handleCreate = () => {
    startTransition(async () => {
      try {
        const res = await apiFetch<{ item: HearingSheet }>("/api/agency/hearing-sheets", {
          method: "POST",
          json: { client_record_id: clientRecordId },
        });
        if (!res?.item) throw new Error("response_missing_item");
        setItems((prev) => [res.item, ...prev]);
        showToast("success", "新規ヒアリングシートを作成しました");
        router.refresh();
      } catch (err) {
        showToast("error", getErrorMessage(err));
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleCreate} disabled={pending}>
          {pending ? "作成中…" : "+ 新規ヒアリング"}
        </Button>
      </div>
      {items.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-sm">
          まだヒアリングシートはありません。「+ 新規ヒアリング」から始めてください。
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id}>
              <HearingSheetEditor
                sheet={it}
                questions={questions}
                isAdmin={isAdmin}
                onChange={(updated) =>
                  setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                }
                onDelete={() => setItems((prev) => prev.filter((p) => p.id !== it.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HearingSheetEditor({
  sheet,
  questions,
  isAdmin,
  onChange,
  onDelete,
}: {
  sheet: HearingSheet;
  questions: HearingQuestionDefinition[];
  isAdmin: boolean;
  onChange: (updated: HearingSheet) => void;
  onDelete: () => void;
}) {
  const [content, setContent] = useState<HearingSheetContent>(sheet.content);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { showToast } = useToast();

  const update = (key: string, value: string) => setContent((prev) => ({ ...prev, [key]: value }));

  const save = (nextStatus?: "draft" | "finalized") => {
    startTransition(async () => {
      try {
        // 過保護 zod validate(最大長などをここで弾く)
        hearingSheetContentSchema.parse(content);
        const res = await apiFetch<{ item: HearingSheet }>(
          `/api/agency/hearing-sheets/${sheet.id}`,
          {
            method: "PATCH",
            json: {
              content,
              ...(nextStatus ? { status: nextStatus } : {}),
              ...(nextStatus === "finalized"
                ? { human_reviewed_at: new Date().toISOString() }
                : {}),
            },
          },
        );
        if (!res?.item) throw new Error("response_missing_item");
        onChange(res.item);
        setSavedAt(new Date());
        showToast(
          "success",
          nextStatus === "finalized"
            ? "ヒアリングを確定しました"
            : nextStatus === "draft"
              ? "編集を再開しました"
              : "ヒアリングを保存しました",
        );
      } catch (err) {
        showToast("error", getErrorMessage(err));
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/hearing-sheets/${sheet.id}`, { method: "DELETE" });
        showToast("success", "ヒアリングシートを削除しました");
        setConfirmOpen(false);
        onDelete();
      } catch (err) {
        showToast("error", getErrorMessage(err));
      }
    });
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">
            作成:{new Date(sheet.createdAt).toLocaleString("ja-JP")}
            {sheet.aiExtractedAt && <> ・ AI 抽出済</>}
            {sheet.humanReviewedAt && <> ・ 確認済</>}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            sheet.status === "finalized"
              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {sheet.status === "finalized" ? "確定済" : "編集中"}
        </span>
      </div>

      {questions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          質問項目が設定されていません。設定 → ヒアリングシート設定 から項目を追加してください。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {questions.map((q) => (
            <Question
              key={q.key}
              label={q.label}
              helpText={q.helpText}
              value={content[q.key] ?? ""}
              maxLength={q.maxLength}
              rows={q.inputType === "text" ? 1 : 3}
              onChange={(v) => update(q.key, v)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-muted-foreground text-xs">
          {savedAt ? `${savedAt.toLocaleTimeString("ja-JP")} に保存しました` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={pending}
            >
              削除
            </Button>
          )}
          {sheet.status === "draft" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => save()} disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
              <Button size="sm" onClick={() => save("finalized")} disabled={pending}>
                {pending ? "確定中…" : "確定する"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => save("draft")} disabled={pending}>
                編集を再開
              </Button>
              <Button size="sm" onClick={() => save()} disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="このヒアリングシートを削除しますか?"
        description="この操作は取り消せません。 記録した内容は復元できなくなります。"
        confirmLabel="削除"
        destructive
        pending={pending}
        onConfirm={handleDelete}
      />
    </Card>
  );
}

function Question({
  label,
  helpText,
  value,
  onChange,
  rows = 3,
  maxLength,
}: {
  label: string;
  helpText?: string | null;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {helpText && <p className="text-muted-foreground text-xs">{helpText}</p>}
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
      />
    </div>
  );
}
