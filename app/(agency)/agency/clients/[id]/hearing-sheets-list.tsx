"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import {
  hearingSheetContentSchema,
  type HearingSheet,
  type HearingSheetContent,
} from "@/lib/agency-client-documents/types";

type Props = {
  clientRecordId: string;
  initialItems: HearingSheet[];
};

/**
 * ヒアリングシート一覧 + インライン編集。
 * 面談中の素早い入力を最優先に、設問単位の textarea を縦に並べる。
 */
export function HearingSheetsList({ clientRecordId, initialItems }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<HearingSheet[]>(initialItems);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await apiFetch<{ item: HearingSheet }>("/api/agency/hearing-sheets", {
          method: "POST",
          json: { client_record_id: clientRecordId },
        });
        if (!res?.item) throw new Error("response_missing_item");
        setItems((prev) => [res.item, ...prev]);
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
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
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
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
  onChange,
  onDelete,
}: {
  sheet: HearingSheet;
  onChange: (updated: HearingSheet) => void;
  onDelete: () => void;
}) {
  const [content, setContent] = useState<HearingSheetContent>(sheet.content);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<HearingSheetContent>) =>
    setContent((prev) => ({ ...prev, ...patch }));

  const save = (nextStatus?: "draft" | "finalized") => {
    setError(null);
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
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const handleDelete = () => {
    if (!confirm("このヒアリングシートを削除します。実行しますか?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/hearing-sheets/${sheet.id}`, { method: "DELETE" });
        onDelete();
      } catch (err) {
        setError(getErrorMessage(err));
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

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Question
          label="現職"
          value={content.current_job}
          onChange={(v) => update({ current_job: v })}
        />
        <Question
          label="転職理由"
          value={content.job_change_reason}
          onChange={(v) => update({ job_change_reason: v })}
        />
        <Question
          label="強み"
          value={content.strengths}
          onChange={(v) => update({ strengths: v })}
        />
        <Question
          label="弱み・課題"
          value={content.weaknesses}
          onChange={(v) => update({ weaknesses: v })}
        />
        <Question
          label="希望業種"
          value={content.desired_industry}
          onChange={(v) => update({ desired_industry: v })}
          rows={2}
        />
        <Question
          label="希望職種"
          value={content.desired_position}
          onChange={(v) => update({ desired_position: v })}
          rows={2}
        />
        <Question
          label="希望勤務地"
          value={content.desired_location}
          onChange={(v) => update({ desired_location: v })}
          rows={2}
        />
        <Question
          label="希望年収"
          value={content.desired_salary}
          onChange={(v) => update({ desired_salary: v })}
          rows={2}
        />
        <Question
          label="動機・志望"
          value={content.motivation}
          onChange={(v) => update({ motivation: v })}
        />
        <Question
          label="入社可能時期"
          value={content.availability}
          onChange={(v) => update({ availability: v })}
          rows={2}
        />
      </div>
      <Question
        label="メモ(自由記述)"
        value={content.notes}
        onChange={(v) => update({ notes: v })}
        rows={4}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-muted-foreground text-xs">
          {savedAt ? `${savedAt.toLocaleTimeString("ja-JP")} に保存しました` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={pending}>
            削除
          </Button>
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
    </Card>
  );
}

function Question({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
    </div>
  );
}
