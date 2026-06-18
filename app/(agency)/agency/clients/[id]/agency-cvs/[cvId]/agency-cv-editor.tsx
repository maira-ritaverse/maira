"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type { AgencyClientCv, CvBody } from "@/lib/agency-client-documents/types";

type Props = {
  clientRecordId: string;
  cv: AgencyClientCv;
  isAdmin: boolean;
};

export function AgencyCvEditor({ clientRecordId, cv, isAdmin }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [title, setTitle] = useState(cv.title);
  const [documentDate, setDocumentDate] = useState(cv.documentDate ?? "");
  const [body, setBody] = useState<CvBody>(cv.body);

  const updateBody = (patch: Partial<CvBody>) => setBody((prev) => ({ ...prev, ...patch }));

  const handleSave = (nextStatus?: "draft" | "final") => {
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/client-cvs/${cv.id}`, {
          method: "PATCH",
          json: {
            title,
            document_date: documentDate || null,
            body,
            ...(nextStatus ? { status: nextStatus } : {}),
          },
        });
        setSavedAt(new Date());
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`「${cv.title}」を削除します。元に戻せません。実行しますか?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/client-cvs/${cv.id}`, { method: "DELETE" });
        router.push(`/agency/clients/${clientRecordId}?tab=documents`);
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const handlePushToSeeker = () => {
    if (
      !confirm(
        "この職務経歴書を求職者本人に送付します。受領後は本人の職務経歴書に取り込まれます。実行しますか?",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/client-cvs/${cv.id}/push-to-seeker`, {
          method: "POST",
          json: {},
        });
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">基本情報</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              cv.status === "final"
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {cv.status === "final" ? "確定済" : "編集中"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="title">タイトル</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="documentDate">日付</Label>
            <Input
              id="documentDate"
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">本文</h2>
        <p className="text-muted-foreground text-xs">
          AES-256-GCM で暗号化保存します。長文(2 万字まで)に対応。
        </p>
        <CvFieldWithAi
          cvId={cv.id}
          kind="cv_summary"
          label="要約(2000 字以内)"
          value={body.summary}
          onChange={(v) => updateBody({ summary: v })}
          rows={4}
          maxLength={2000}
          placeholder="冒頭の職務要約。求人企業が最初に読む 30 秒分。"
          parentPending={pending}
        />
        <CvFieldWithAi
          cvId={cv.id}
          kind="cv_body"
          label="本文(20000 字以内)"
          value={body.body}
          onChange={(v) => updateBody({ body: v })}
          rows={20}
          maxLength={20000}
          placeholder={`【職務経歴】\n○○年○月 〜 ○○年○月 株式会社○○\n  ・担当業務\n  ・実績(数値で書く)\n\n【技術スタック】\n  ・…\n\n【自己 PR】\n  ・…`}
          parentPending={pending}
        />
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-muted-foreground text-xs">
          {savedAt ? `${savedAt.toLocaleTimeString("ja-JP")} に保存しました` : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button variant="destructive" onClick={handleDelete} disabled={pending}>
              削除
            </Button>
          )}
          {cv.status === "draft" ? (
            <>
              <Button variant="outline" onClick={() => handleSave()} disabled={pending}>
                {pending ? "保存中…" : "下書き保存"}
              </Button>
              <Button onClick={() => handleSave("final")} disabled={pending}>
                {pending ? "確定中…" : "確定する"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleSave("draft")} disabled={pending}>
                編集を再開
              </Button>
              <Button variant="outline" onClick={() => handleSave()} disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
              {cv.pushedToDraftId ? (
                <Button disabled>送付済み</Button>
              ) : (
                <Button onClick={handlePushToSeeker} disabled={pending}>
                  {pending ? "送付中…" : "求職者本人に送付"}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * CV 用 Textarea + AI 生成 ボタン。
 * 履歴書の TextareaWithAi と同じパターンだが、kind を cv_summary / cv_body にする。
 */
function CvFieldWithAi({
  cvId,
  kind,
  label,
  value,
  onChange,
  rows,
  maxLength,
  placeholder,
  parentPending,
}: {
  cvId: string;
  kind: "cv_summary" | "cv_body";
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  maxLength: number;
  placeholder?: string;
  parentPending: boolean;
}) {
  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCandidate, setAiCandidate] = useState<string | null>(null);

  const isBusy = parentPending || aiPending;

  const handleAi = () => {
    setAiError(null);
    setAiCandidate(null);
    startAi(async () => {
      try {
        const res = await apiFetch<{ text: string }>(`/api/agency/client-cvs/${cvId}/ai-write`, {
          method: "POST",
          json: { kind },
        });
        if (!res?.text) throw new Error("response_missing_text");
        setAiCandidate(res.text);
      } catch (err) {
        setAiError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button type="button" size="sm" variant="outline" onClick={handleAi} disabled={isBusy}>
          {aiPending ? "AI 生成中…" : "AI で生成"}
        </Button>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
      />
      {aiError && <p className="text-destructive text-xs">{aiError}</p>}
      {aiCandidate && (
        <div className="bg-muted/40 mt-2 space-y-2 rounded-md border p-3">
          <p className="text-muted-foreground text-xs">AI が生成した文案(プレビュー):</p>
          <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
            {aiCandidate}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAiCandidate(null)}
              disabled={isBusy}
            >
              破棄
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(aiCandidate);
                setAiCandidate(null);
              }}
              disabled={isBusy}
            >
              この文案で上書き
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
